"""Voix locale de Cyphed : Pocket TTS (Kyutai), lancé par Cyphed dans le Python qu'il a installé.

Avec --prefetch : télécharge le modèle et la voix Estelle, dit « Bonjour. » pour vérifier, et s'arrête.

Protocole (entrée / sortie standard) :
- entrée : une ligne JSON par demande, {"id": 1, "text": "...", "voice": "estelle"} ;
- sortie : des trames, chacune = 4 octets (longueur de l'en-tête JSON) + 4 octets (longueur des données),
  little-endian, puis l'en-tête puis les données. Première trame : {"ready": true}. Ensuite, pour
  chaque demande, {"id": 1} + un fichier WAV (PCM 16 bits mono), ou {"id": 1, "error": "..."} sans données.

Rien ne sort du PC. Les journaux vont sur l'erreur standard, que Cyphed n'enregistre pas.
"""
import io
import json
import re
import struct
import sys
import wave

import numpy as np
from pocket_tts import TTSModel

# Voix intégrées seulement : un nom simple, jamais un chemin de fichier.
VOIX_OK = re.compile(r"^[a-z][a-z0-9_-]{0,31}$")
out = sys.stdout.buffer


def envoyer(entete, donnees=b""):
    brut = json.dumps(entete).encode("utf-8")
    out.write(struct.pack("<II", len(brut), len(donnees)) + brut + donnees)
    out.flush()


def en_wav(audio, sr):
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    tampon = io.BytesIO()
    with wave.open(tampon, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm)
    return tampon.getvalue()


# Réglages retenus par le studio voix (docs/decisions.md) : température 0,5, 5 étapes, 6 trames après la fin.
modele = TTSModel.load_model(language="french", temp=0.5, sampler_decode_steps=5)
modele.pad_with_spaces_for_short_inputs = True
etats = {}
fondu = int(0.08 * modele.sample_rate)

if "--prefetch" in sys.argv:
    # Installation : télécharge le modèle et la voix, vérifie qu'une phrase sort, puis s'arrête.
    essai = modele.generate_audio(modele.get_state_for_audio_prompt("estelle"), "Bonjour.", frames_after_eos=6)
    if len(essai) == 0:
        sys.exit(2)
    print("[pocket] prête", file=sys.stderr, flush=True)
    sys.exit(0)

envoyer({"ready": True, "sampleRate": modele.sample_rate})

for ligne in sys.stdin:
    demande = None
    try:
        demande = json.loads(ligne)
        ident = demande.get("id")
        texte = str(demande.get("text", "")).strip()
        voix = str(demande.get("voice", "estelle"))
        if not texte or not VOIX_OK.match(voix):
            raise ValueError("demande invalide")
        if voix not in etats:
            etats[voix] = modele.get_state_for_audio_prompt(voix)
        audio = modele.generate_audio(etats[voix], texte, frames_after_eos=6).numpy().astype(np.float32)
        # Fondu de 80 ms au début : retire le petit claquement (ticket Kyutai #171).
        n = min(fondu, len(audio))
        audio[:n] *= np.linspace(0, 1, n)
        envoyer({"id": ident}, en_wav(audio, modele.sample_rate))
    except Exception as err:  # une phrase ratée ne doit pas arrêter la voix
        print(f"[pocket] {err}", file=sys.stderr, flush=True)
        envoyer({"id": demande.get("id") if isinstance(demande, dict) else None, "error": str(err)[:200]})
