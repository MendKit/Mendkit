# Switching on code signing

MendKit builds unsigned until certificates are added. Nothing in the code needs to change: the release workflow
signs automatically as soon as the repository secrets below exist (GitHub, Settings, Secrets and variables, Actions).

## Why sign
- **Windows:** unsigned installers show the blue "Windows protected your PC" SmartScreen screen. A signed one does not
  (an OV certificate builds reputation over a few weeks; an EV certificate or Azure Trusted Signing is trusted at once).
- **Mac:** unsigned apps are blocked by Gatekeeper ("cannot be opened because Apple cannot check it"). Signing with a
  Developer ID and notarizing removes that.

## Windows
1. Buy a code-signing certificate (Certum, Sectigo, SSL.com, DigiCert) or use Azure Trusted Signing.
2. Export it as a `.pfx` file with a password.
3. Turn it into one line of base64: `base64 -w0 cert.pfx > cert.txt` (Mac: `base64 -i cert.pfx -o cert.txt`).
4. Add the secrets `WIN_CSC_LINK` (the contents of cert.txt) and `WIN_CSC_KEY_PASSWORD` (the password).

Note: certificates issued since June 2023 live on a hardware token or cloud HSM and cannot be exported as `.pfx`.
For those, use the provider's cloud signing (SSL.com eSigner, Azure Trusted Signing) and add a signing step after the
build; ask Claude to wire in the provider you choose.

## Mac
1. Join the Apple Developer Program ($99 a year).
2. In Xcode or developer.apple.com create a **Developer ID Application** certificate, install it, and export it from
   Keychain Access as a `.p12` with a password.
3. Base64 it as above and add `CSC_LINK` and `CSC_KEY_PASSWORD`.
4. For notarization, create an app-specific password at appleid.apple.com and add `APPLE_ID` (your Apple ID email),
   `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` (10 characters, shown in the developer account).

## Check
Run the Release workflow without publishing. The "Check the Mac app signature" step shows the Developer ID
authority, and the Windows installer's Properties, Digital Signatures tab shows your name.
