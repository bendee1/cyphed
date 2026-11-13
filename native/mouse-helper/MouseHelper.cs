// mouse-helper : crochet souris global (WH_MOUSE_LL) dans son propre processus, pour les raccourcis à bouton de souris.
// Pourquoi à part : Windows attend la réponse du crochet avant de bouger la souris de tout le PC. Posé dans Cyphed,
// il dépendait du fil principal d'Electron : au démarrage, à l'arrêt ou pendant une mise à jour, la souris gelait.
// Ici, le crochet répond tout de suite, sans jamais attendre Cyphed.
//
// Protocole (lignes UTF-8) :
//   stdin  : "state <capture 0|1> <bouton>:<vk>,<vk>;<bouton>:..."  boutons à avaler (4 milieu, 5 précédent, 6 suivant)
//   stdout : "d <bouton> <avalé 0|1>" (pressé), "u <bouton> <avalé>" (relâché), "ready" au départ ; seulement pour 4, 5 et 6, jamais pour un clic simulé.
//            "lag <ms>" : un mouvement de souris arrivé ici plus de 100 ms après avoir eu lieu (gel du PC), au plus une ligne par 500 ms.
// Se ferme quand stdin se ferme (Cyphed parti). Aucun accès réseau, rien d'autre n'est lu.
// Compilé avec csc.exe du .NET Framework 4.x (C# 5).
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class MouseHelper
{
    delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    struct MSLLHOOKSTRUCT
    {
        public int x;
        public int y;
        public uint mouseData;
        public uint flags;
        public uint time;
        public UIntPtr extra;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public int x;
        public int y;
    }

    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr SetWindowsHookExW(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);
    [DllImport("user32.dll")]
    static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")]
    static extern bool UnhookWindowsHookEx(IntPtr hhk);
    [DllImport("user32.dll")]
    static extern int GetMessageW(out MSG msg, IntPtr hWnd, uint min, uint max);
    [DllImport("user32.dll")]
    static extern bool PeekMessageW(out MSG msg, IntPtr hWnd, uint min, uint max, uint remove);
    [DllImport("user32.dll")]
    static extern bool PostThreadMessageW(uint threadId, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")]
    static extern short GetAsyncKeyState(int vKey);
    [DllImport("kernel32.dll")]
    static extern IntPtr GetModuleHandleW(IntPtr name);
    [DllImport("kernel32.dll")]
    static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll")]
    static extern uint GetTickCount();

    const int WH_MOUSE_LL = 14;
    const int WM_MOUSEMOVE = 0x0200;
    const int LAG_REPORT_MS = 100;
    const int WM_MBUTTONDOWN = 0x0207, WM_MBUTTONUP = 0x0208, WM_XBUTTONDOWN = 0x020b, WM_XBUTTONUP = 0x020c;
    const uint WM_QUIT = 0x0012;
    const uint LLMHF_INJECTED = 1;

    static readonly object Gate = new object();
    static List<KeyValuePair<int, int[]>> rules = new List<KeyValuePair<int, int[]>>();
    static bool capture;
    static readonly bool[] swallowed = new bool[8];
    static readonly BlockingCollection<string> outbox = new BlockingCollection<string>();
    static HookProc proc; // gardé en vie : le ramasse-miettes ne doit pas le libérer
    static IntPtr hook = IntPtr.Zero;
    static uint lastLagReport;

    static int Main()
    {
        // Ce processus ne fait que répondre au crochet : il passe avant les autres pour que la souris n'attende jamais.
        try { Process.GetCurrentProcess().PriorityClass = ProcessPriorityClass.High; } catch { }
        Thread.CurrentThread.Priority = ThreadPriority.Highest;
        uint mainThread = GetCurrentThreadId();

        var writer = new Thread(WriteLoop);
        writer.IsBackground = true;
        writer.Start();
        var reader = new Thread(() => ReadLoop(mainThread));
        reader.IsBackground = true;
        reader.Start();

        // Tout préparer AVANT de poser le crochet : compilation du rappel, structures, verrou, file.
        // Sinon le premier mouvement de souris attend ce travail (lent juste après une installation) et la souris gèle.
        proc = OnMouse;
        RuntimeHelpers.PrepareDelegate(proc);
        RuntimeHelpers.PrepareMethod(typeof(MouseHelper).GetMethod("OnMouse", BindingFlags.NonPublic | BindingFlags.Static).MethodHandle);
        RuntimeHelpers.PrepareMethod(typeof(MouseHelper).GetMethod("Matches", BindingFlags.NonPublic | BindingFlags.Static).MethodHandle);
        Marshal.SizeOf(typeof(MSLLHOOKSTRUCT));
        lock (Gate) { Matches(4); }
        GetAsyncKeyState(0x11);
        GetTickCount();
        IntPtr warm = Marshal.AllocHGlobal(40);
        Marshal.ReadInt32(warm, 12);
        Marshal.FreeHGlobal(warm);
        MSG msg;
        PeekMessageW(out msg, IntPtr.Zero, 0, 0, 0); // crée la file de messages du fil avant le crochet

        hook = SetWindowsHookExW(WH_MOUSE_LL, proc, GetModuleHandleW(IntPtr.Zero), 0);
        if (hook == IntPtr.Zero) return 2;
        outbox.Add("ready");
        while (GetMessageW(out msg, IntPtr.Zero, 0, 0) > 0) { }
        UnhookWindowsHookEx(hook);
        return 0;
    }

    // Le crochet ne fait que décider et poser une ligne en file : jamais d'écriture bloquante ici.
    static IntPtr OnMouse(int nCode, IntPtr wParam, IntPtr lParam)
    {
        try
        {
            int msg = wParam.ToInt32();
            if (nCode >= 0 && msg == WM_MOUSEMOVE)
            {
                // Mesure du gel : Windows date chaque mouvement ; s'il arrive en retard, le PC a gelé avant nous.
                // Lecture directe des champs (flags à +12, time à +16) : aucune allocation à chaque mouvement.
                uint flags = (uint)Marshal.ReadInt32(lParam, 12);
                uint time = (uint)Marshal.ReadInt32(lParam, 16);
                uint now = GetTickCount();
                uint lag = now - time;
                if ((flags & LLMHF_INJECTED) == 0 && lag > LAG_REPORT_MS && lag < 60000 && now - lastLagReport >= 500)
                {
                    lastLagReport = now;
                    outbox.Add("lag " + lag);
                }
            }
            else if (nCode >= 0 && (msg == WM_MBUTTONDOWN || msg == WM_MBUTTONUP || msg == WM_XBUTTONDOWN || msg == WM_XBUTTONUP))
            {
                var data = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT));
                if ((data.flags & LLMHF_INJECTED) == 0)
                {
                    int button = (msg == WM_MBUTTONDOWN || msg == WM_MBUTTONUP) ? 4 : ((data.mouseData >> 16) == 1 ? 5 : 6);
                    bool down = msg == WM_MBUTTONDOWN || msg == WM_XBUTTONDOWN;
                    bool swallow;
                    lock (Gate)
                    {
                        if (down)
                        {
                            swallow = capture || Matches(button);
                            capture = false;
                            swallowed[button] = swallow;
                        }
                        else
                        {
                            swallow = swallowed[button];
                            swallowed[button] = false;
                        }
                    }
                    outbox.Add((down ? "d " : "u ") + button + (swallow ? " 1" : " 0"));
                    if (swallow) return (IntPtr)1;
                }
            }
        }
        catch
        {
            // ne jamais casser la chaîne de crochets
        }
        return CallNextHookEx(hook, nCode, wParam, lParam);
    }

    static bool Matches(int button)
    {
        foreach (var rule in rules)
        {
            if (rule.Key != button) continue;
            bool all = true;
            foreach (int vk in rule.Value)
            {
                if ((GetAsyncKeyState(vk) & 0x8000) == 0) { all = false; break; }
            }
            if (all) return true;
        }
        return false;
    }

    static void WriteLoop()
    {
        var stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
        stdout.AutoFlush = true;
        try
        {
            foreach (string line in outbox.GetConsumingEnumerable()) stdout.Write(line + "\n");
        }
        catch
        {
            // Cyphed parti : le lecteur fermera le processus
        }
    }

    static void ReadLoop(uint mainThread)
    {
        try
        {
            var stdin = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
            string line;
            while ((line = stdin.ReadLine()) != null) Apply(line.Trim());
        }
        catch
        {
            // flux cassé : on s'arrête comme à la fermeture
        }
        PostThreadMessageW(mainThread, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
    }

    // "state 0 5:;6:17" : pas de capture, Mouse4 seul, Control+Mouse5.
    static void Apply(string line)
    {
        string[] parts = line.Split(new[] { ' ' }, 3);
        if (parts.Length < 2 || parts[0] != "state") return;
        var next = new List<KeyValuePair<int, int[]>>();
        if (parts.Length == 3)
        {
            foreach (string item in parts[2].Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries))
            {
                string[] kv = item.Split(':');
                int button;
                if (!int.TryParse(kv[0], out button) || button < 4 || button > 6) continue;
                var mods = new List<int>();
                if (kv.Length > 1)
                {
                    foreach (string m in kv[1].Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries))
                    {
                        int vk;
                        if (int.TryParse(m, out vk)) mods.Add(vk);
                    }
                }
                next.Add(new KeyValuePair<int, int[]>(button, mods.ToArray()));
            }
        }
        lock (Gate)
        {
            rules = next;
            capture = parts[1] == "1";
        }
    }
}
