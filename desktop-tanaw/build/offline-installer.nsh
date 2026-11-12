; The NSIS bootstrapper is shipped inside the complete offline SFX, together
; with its payload. Fail closed before the stock web target can download it.
!macro customInit
  !ifndef BUILD_UNINSTALLER
    ${IfNot} ${FileExists} "$EXEDIR\${APP_64_NAME}"
      MessageBox MB_OK|MB_ICONSTOP "The offline installation payload is missing. Please download and run the complete TANAW offline installer."
      Abort
    ${EndIf}
    ${StdUtils.HashFile} $R0 "SHA2-512" "$EXEDIR\${APP_64_NAME}"
    ${If} $R0 != "${APP_64_HASH}"
      MessageBox MB_OK|MB_ICONSTOP "The offline installation payload is damaged. Please download the complete TANAW offline installer again."
      Abort
    ${EndIf}
  !endif
!macroend

!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TEXT "Uninstalling TANAW removes its local camera settings, saved sign-in, reports, and logs for this Windows account. Any reports that have not synced will be lost.$\r$\n$\r$\nClick Next to continue."
  !insertmacro MUI_UNPAGE_WELCOME
!macroend

!macro removeTanawLocalDirectory DIRECTORY
  ${If} ${FileExists} "${DIRECTORY}\."
    ClearErrors
    RMDir /r "${DIRECTORY}"
    ${If} ${Errors}
      MessageBox MB_OK|MB_ICONSTOP "TANAW could not clear its local files in ${DIRECTORY}. Close TANAW and retry the uninstall." /SD IDOK
      SetErrorLevel 1
      Abort
    ${EndIf}
  ${EndIf}
!macroend

!macro customUnInstall
  ; Electron Builder invokes the previous uninstaller with --updated on upgrades.
  ${IfNot} ${isUpdated}
    SetShellVarContext current
    !insertmacro removeTanawLocalDirectory "$APPDATA\${PRODUCT_NAME}"
    !insertmacro removeTanawLocalDirectory "$LOCALAPPDATA\${APP_PACKAGE_NAME}-updater"
    ${If} $installMode == "all"
      SetShellVarContext all
    ${EndIf}
  ${EndIf}
!macroend
