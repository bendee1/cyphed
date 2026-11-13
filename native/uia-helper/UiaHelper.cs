// uia-helper : lit le champ de texte au premier plan via Windows UI Automation.
// Protocole : une requête JSON par ligne sur stdin, une réponse JSON par ligne sur stdout (UTF-8).
// Vie privée : jamais de texte sur stderr, aucun texte pour un champ mot de passe ou jugé sensible (nom, identifiant ou libellé), aucun accès réseau.
// Compilé avec csc.exe du .NET Framework 4.x (C# 5 : pas d'interpolation ni de "?.").
using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Automation;
using System.Windows.Automation.Text;

internal sealed class HelperError : Exception
{
    public HelperError(string code) : base(code) { }
}

internal sealed class Snap
{
    public string Process = "";
    public string ControlType = "";
    public bool Editable;
    public bool ReadOnly;
    public bool Password;
    public bool Supported;
    public bool Caret;
    public string Before = "";
    public string Selected = "";
    public string After = "";
    public int Length;
    public string Text; // null hors commande "read"
}

internal static class UiaHelper
{
    const int RequestTimeoutMs = 800;
    const int MaxBefore = 1500;
    const int MaxAfter = 500;
    const int MaxSelected = 3000;
    const int MaxText = 20000;
    const int DocCap = 100000; // au-delà, "length" est plafonné
    const int MaxStuck = 3;

    static readonly object OutLock = new object();
    static StreamWriter Out;
    static Thread Warm;
    static int _active; // threads UIA en cours (bloqués après un timeout compris)

    static int Main()
    {
        UTF8Encoding utf8 = new UTF8Encoding(false);
        StreamReader input = new StreamReader(Console.OpenStandardInput(), utf8);
        Out = new StreamWriter(Console.OpenStandardOutput(), utf8);
        Out.AutoFlush = true;
        Out.NewLine = "\n";

        // Le chargement de UIAutomationClient coûte ~100-300 ms : on le paie au démarrage.
        Warm = new Thread(delegate ()
        {
            try { AutomationElement.FocusedElement.GetHashCode(); } catch (Exception) { }
        });
        Warm.IsBackground = true;
        Warm.Start();

        string line;
        while ((line = input.ReadLine()) != null)
        {
            if (line.Trim().Length == 0) continue;
            try { Handle(line); }
            catch (Exception) { Reply(null, "{\"ok\":false,\"error\":\"internal\"}"); }
        }
        return 0;
    }

    static void Handle(string line)
    {
        string idRaw;
        string cmd;
        if (!ParseRequest(line, out idRaw, out cmd))
        {
            Reply(idRaw, "{\"ok\":false,\"error\":\"bad-request\"}");
            return;
        }

        if (cmd == "ping")
        {
            if (Warm != null && Warm.IsAlive) Warm.Join(600);
            Reply(idRaw, "{\"ok\":true}");
            return;
        }
        if (cmd != "focus" && cmd != "read")
        {
            Reply(idRaw, "{\"ok\":false,\"error\":\"unknown-cmd\"}");
            return;
        }

        if (Thread.VolatileRead(ref _active) >= MaxStuck)
        {
            // UIA est coincé dans des appels qui ne reviennent pas : on laisse le client nous relancer.
            Reply(idRaw, "{\"ok\":false,\"error\":\"stuck\"}");
            Environment.Exit(4);
        }

        bool full = cmd == "read";
        string body = null;
        Interlocked.Increment(ref _active);
        Thread worker = new Thread(delegate ()
        {
            try
            {
                // Évite deux initialisations COM concurrentes au tout premier appel.
                try { if (Warm != null && Warm.IsAlive) Warm.Join(700); } catch (Exception) { }
                try { body = Json(Capture(full)); }
                catch (HelperError e) { body = Fail(e.Message); }
                catch (ElementNotAvailableException) { body = Fail("gone"); }
                catch (System.Runtime.InteropServices.COMException) { body = Fail("com"); }
                catch (InvalidOperationException) { body = Fail("invalid"); }
                catch (UnauthorizedAccessException) { body = Fail("denied"); }
                catch (Exception) { body = Fail("error"); }
            }
            finally { Interlocked.Decrement(ref _active); }
        });
        worker.IsBackground = true;
        worker.Start();

        if (!worker.Join(RequestTimeoutMs))
        {
            Reply(idRaw, Fail("timeout"));
            return;
        }
        Reply(idRaw, body);
    }

    static string Fail(string code)
    {
        return "{\"ok\":false,\"error\":" + Quote(code) + "}";
    }

    // body = objet JSON complet commençant par "{" ; on y insère l'id juste après.
    static void Reply(string idRaw, string body)
    {
        string text = idRaw == null ? body : "{\"id\":" + idRaw + "," + body.Substring(1);
        lock (OutLock) { Out.WriteLine(text); }
    }

    // ---------- Lecture UIA ----------

    static Snap Capture(bool full)
    {
        AutomationElement el = AutomationElement.FocusedElement;
        if (el == null) throw new HelperError("no-focus");

        Snap s = new Snap();
        AutomationElement.AutomationElementInformation cur = el.Current;
        s.ControlType = cur.ControlType.ProgrammaticName.Replace("ControlType.", "");
        s.Process = ProcessName(cur.ProcessId);
        s.Password = cur.IsPassword || IsSensitiveField(el, cur);
        if (full) s.Text = "";

        // Champ mot de passe : on s'arrête avant toute lecture de texte.
        if (s.Password)
        {
            s.Editable = true;
            return s;
        }

        object o;
        ValuePattern vp = null;
        if (el.TryGetCurrentPattern(ValuePattern.Pattern, out o)) vp = (ValuePattern)o;
        if (vp != null) s.ReadOnly = vp.Current.IsReadOnly;

        bool done = false;
        if (el.TryGetCurrentPattern(TextPattern.Pattern, out o))
        {
            try { done = ReadTextPattern((TextPattern)o, s, full, vp == null); }
            catch (ElementNotAvailableException) { throw; }
            catch (Exception) { done = false; }
        }
        if (!done && vp != null) ReadValuePattern(vp, s, full);

        s.Editable = s.Supported && !s.ReadOnly && IsEditType(s.ControlType, vp != null);
        return s;
    }

    // Champ sensible même sans IsPassword (code de carte, IBAN, code reçu par SMS, jeton...) : repéré par son nom,
    // son identifiant d'automatisation ou son libellé (LabeledBy). Traité comme un mot de passe : aucun texte rendu.
    static readonly Regex SensitiveName = new Regex(
        @"pass|mot de passe|\bpwd\b|\bcvv\b|\bcvc\b|\biban\b|\botp\b|code de v.{1,2}rification|card number|num.{1,2}ro de carte|secret|token",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    static bool IsSensitiveField(AutomationElement el, AutomationElement.AutomationElementInformation cur)
    {
        try
        {
            if (SensitiveName.IsMatch(cur.Name ?? "")) return true;
            if (SensitiveName.IsMatch(cur.AutomationId ?? "")) return true;
            AutomationElement label = cur.LabeledBy;
            if (label != null && SensitiveName.IsMatch(label.Current.Name ?? "")) return true;
        }
        catch (ElementNotAvailableException) { throw; }
        catch (Exception) { }
        return false;
    }

    static bool IsEditType(string controlType, bool hasValue)
    {
        return controlType == "Edit" || controlType == "ComboBox" || controlType == "Document" || hasValue;
    }

    static bool ReadTextPattern(TextPattern tp, Snap s, bool full, bool readOnlyUnknown)
    {
        TextPatternRange doc = tp.DocumentRange;
        string all = doc.GetText(DocCap);
        if (all == null) all = "";
        s.Length = all.Length;

        if (readOnlyUnknown)
        {
            try
            {
                object ro = doc.GetAttributeValue(TextPattern.IsReadOnlyAttribute);
                if (ro is bool) s.ReadOnly = (bool)ro;
            }
            catch (Exception) { }
        }

        TextPatternRange[] sels = null;
        try { sels = tp.GetSelection(); } catch (InvalidOperationException) { }

        if (sels == null || sels.Length == 0)
        {
            // Pas de curseur exposé : tout le texte dans "before".
            s.Supported = true;
            s.Caret = false;
            s.Before = TakeLast(all, MaxBefore);
            if (full) s.Text = TakeFirst(all, MaxText);
            return true;
        }

        TextPatternRange sel = sels[0];
        s.Supported = true;
        s.Caret = true;
        s.Selected = TakeFirst(sel.GetText(MaxSelected) ?? "", MaxSelected);

        TextPatternRange before = sel.Clone();
        before.MoveEndpointByRange(TextPatternRangeEndpoint.End, sel, TextPatternRangeEndpoint.Start);
        before.MoveEndpointByUnit(TextPatternRangeEndpoint.Start, TextUnit.Character, -MaxBefore);
        s.Before = TakeLast(before.GetText(MaxBefore) ?? "", MaxBefore);

        TextPatternRange after = sel.Clone();
        after.MoveEndpointByRange(TextPatternRangeEndpoint.Start, sel, TextPatternRangeEndpoint.End);
        after.MoveEndpointByUnit(TextPatternRangeEndpoint.End, TextUnit.Character, MaxAfter);
        s.After = TakeFirst(after.GetText(MaxAfter) ?? "", MaxAfter);

        int known = s.Before.Length + s.Selected.Length + s.After.Length;
        if (all.Length < known)
        {
            // Certains fournisseurs (terminaux Chromium) donnent un DocumentRange plus court que ses sous-plages.
            s.Length = known;
            if (full) s.Text = TakeFirst(s.Before + s.Selected + s.After, MaxText);
            return true;
        }

        if (full)
        {
            if (all.Length <= MaxText) s.Text = all;
            else
            {
                // Texte long : fenêtre qui se termine juste après le curseur, là où le collage a lieu.
                TextPatternRange head = doc.Clone();
                head.MoveEndpointByRange(TextPatternRangeEndpoint.End, sel, TextPatternRangeEndpoint.End);
                int end = Math.Min(all.Length, (head.GetText(DocCap) ?? "").Length + MaxAfter);
                int start = Math.Max(0, end - MaxText);
                s.Text = all.Substring(start, end - start);
            }
        }
        return true;
    }

    static void ReadValuePattern(ValuePattern vp, Snap s, bool full)
    {
        string v = vp.Current.Value ?? "";
        s.Supported = true;
        s.Caret = false; // UIA n'expose pas la position du curseur via ValuePattern
        s.Length = v.Length;
        s.Before = TakeLast(v, MaxBefore);
        if (full) s.Text = TakeFirst(v, MaxText);
    }

    static string ProcessName(int pid)
    {
        try
        {
            using (Process p = Process.GetProcessById(pid)) return p.ProcessName;
        }
        catch (Exception) { return ""; }
    }

    // Coupe sans casser une paire de substituts UTF-16.
    static string TakeFirst(string s, int max)
    {
        if (s.Length <= max) return s;
        if (max > 0 && char.IsHighSurrogate(s[max - 1])) max--;
        return s.Substring(0, max);
    }

    static string TakeLast(string s, int max)
    {
        if (s.Length <= max) return s;
        int start = s.Length - max;
        if (start < s.Length && char.IsLowSurrogate(s[start])) start++;
        return s.Substring(start);
    }

    // ---------- JSON ----------

    static string Json(Snap s)
    {
        StringBuilder b = new StringBuilder(256 + s.Before.Length + s.After.Length);
        b.Append("{\"ok\":true,\"process\":").Append(Quote(s.Process));
        b.Append(",\"controlType\":").Append(Quote(s.ControlType));
        b.Append(",\"editable\":").Append(Bool(s.Editable));
        b.Append(",\"readOnly\":").Append(Bool(s.ReadOnly));
        b.Append(",\"password\":").Append(Bool(s.Password));
        b.Append(",\"supported\":").Append(Bool(s.Supported));
        b.Append(",\"caret\":").Append(Bool(s.Caret));
        b.Append(",\"before\":").Append(Quote(s.Password ? "" : s.Before));
        b.Append(",\"selected\":").Append(Quote(s.Password ? "" : s.Selected));
        b.Append(",\"after\":").Append(Quote(s.Password ? "" : s.After));
        b.Append(",\"length\":").Append(s.Length);
        if (s.Text != null) b.Append(",\"text\":").Append(Quote(s.Password ? "" : s.Text));
        b.Append('}');
        return b.ToString();
    }

    static string Bool(bool v) { return v ? "true" : "false"; }

    // ASCII pur : les caractères non ASCII sortent en \uXXXX, donc aucun souci d'encodage ni de substitut orphelin.
    static string Quote(string s)
    {
        StringBuilder b = new StringBuilder(s.Length + 2);
        b.Append('"');
        for (int i = 0; i < s.Length; i++)
        {
            char c = s[i];
            switch (c)
            {
                case '"': b.Append("\\\""); break;
                case '\\': b.Append("\\\\"); break;
                case '\n': b.Append("\\n"); break;
                case '\r': b.Append("\\r"); break;
                case '\t': b.Append("\\t"); break;
                default:
                    if (c < 0x20 || c > 0x7e) b.Append("\\u").Append(((int)c).ToString("x4"));
                    else b.Append(c);
                    break;
            }
        }
        b.Append('"');
        return b.ToString();
    }

    static readonly Regex NumberRe = new Regex(@"^-?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?$");

    // Lit un objet JSON plat : renvoie l'id tel quel (jeton brut) et la commande décodée.
    static bool ParseRequest(string line, out string idRaw, out string cmd)
    {
        idRaw = null;
        cmd = null;
        int i = 0;
        SkipWs(line, ref i);
        if (i >= line.Length || line[i] != '{') return false;
        i++;
        while (true)
        {
            SkipWs(line, ref i);
            if (i >= line.Length) return false;
            if (line[i] == '}') break;
            if (line[i] == ',') { i++; continue; }
            if (line[i] != '"') return false;
            int ks = i;
            if (!SkipString(line, ref i)) return false;
            string key = Unquote(line.Substring(ks, i - ks));
            SkipWs(line, ref i);
            if (i >= line.Length || line[i] != ':') return false;
            i++;
            SkipWs(line, ref i);
            int vs = i;
            if (!SkipValue(line, ref i)) return false;
            string raw = line.Substring(vs, i - vs).Trim();
            if (key == "id")
            {
                if (NumberRe.IsMatch(raw) || (raw.Length >= 2 && raw[0] == '"')) idRaw = raw;
            }
            else if (key == "cmd" && raw.Length >= 2 && raw[0] == '"') cmd = Unquote(raw);
        }
        return cmd != null;
    }

    static void SkipWs(string s, ref int i)
    {
        while (i < s.Length && char.IsWhiteSpace(s[i])) i++;
    }

    static bool SkipString(string s, ref int i)
    {
        i++; // guillemet ouvrant
        while (i < s.Length)
        {
            char c = s[i];
            if (c == '\\') { i += 2; continue; }
            i++;
            if (c == '"') return true;
        }
        return false;
    }

    static bool SkipValue(string s, ref int i)
    {
        if (i >= s.Length) return false;
        if (s[i] == '"') return SkipString(s, ref i);
        if (s[i] == '{' || s[i] == '[')
        {
            int depth = 0;
            while (i < s.Length)
            {
                char c = s[i];
                if (c == '"') { if (!SkipString(s, ref i)) return false; continue; }
                if (c == '{' || c == '[') depth++;
                else if (c == '}' || c == ']') { depth--; if (depth == 0) { i++; return true; } }
                i++;
            }
            return false;
        }
        while (i < s.Length && s[i] != ',' && s[i] != '}') i++;
        return true;
    }

    static string Unquote(string raw)
    {
        if (raw.Length < 2) return "";
        StringBuilder b = new StringBuilder(raw.Length);
        for (int i = 1; i < raw.Length - 1; i++)
        {
            char c = raw[i];
            if (c != '\\' || i + 1 >= raw.Length - 1) { b.Append(c); continue; }
            char n = raw[++i];
            switch (n)
            {
                case 'n': b.Append('\n'); break;
                case 'r': b.Append('\r'); break;
                case 't': b.Append('\t'); break;
                case 'b': b.Append('\b'); break;
                case 'f': b.Append('\f'); break;
                case 'u':
                    int code;
                    if (i + 4 < raw.Length && int.TryParse(raw.Substring(i + 1, 4), System.Globalization.NumberStyles.HexNumber, null, out code))
                    {
                        b.Append((char)code);
                        i += 4;
                    }
                    break;
                default: b.Append(n); break;
            }
        }
        return b.ToString();
    }
}
