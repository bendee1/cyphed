; Réglages de l'installeur Cyphed (inclus par electron-builder, voir "nsis.include" dans package.json).
; Une mise à jour (--updated) montre seulement la barre de progression puis relance Cyphed, sans aucun clic.
; L'installeur tourne en priorité basse : la décompression ne passe jamais avant la souris et les fenêtres.

!macro customInit
  ; BELOW_NORMAL_PRIORITY_CLASS sur le processus courant ; la décompression et les programmes lancés directement en héritent (pas Cyphed, relancé par le shell).
  System::Call 'kernel32::SetPriorityClass(p -1, i 0x00004000) i'
!macroend

!macro customInstallMode
  ; Une mise à jour garde l'installation existante (pour cet utilisateur) : pas de page « pour moi ou pour tous ».
  ${if} ${isUpdated}
    StrCpy $isForceCurrentInstall "1"
  ${endIf}
!macroend

!macro customFinishPage
  Function CyphedStartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  ; Après une mise à jour : relancer Cyphed et fermer l'installeur, sans page « Terminer ».
  Function CyphedFinishPre
    ${if} ${isUpdated}
      Call CyphedStartApp
      Abort
    ${endif}
  FunctionEnd

  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "CyphedStartApp"
  !define MUI_PAGE_CUSTOMFUNCTION_PRE CyphedFinishPre
  !insertmacro MUI_PAGE_FINISH
!macroend
