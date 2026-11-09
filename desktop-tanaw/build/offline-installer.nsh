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
