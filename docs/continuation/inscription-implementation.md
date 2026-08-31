# Inscription UI implementation

The selected Inscription direction is now the default application presentation.
The legacy presentation remains available by setting `KALL_UI_THEME=legacy`.

The shared shell uses a warm near-black canvas, low-glare surfaces, restrained
fjord-blue accents, Epilogue for interface copy and Cormorant Garamond for the
editorial display layer. The bundled Google Fonts loader serves the fonts through
the Next build; Cormorant Garamond is distributed under the SIL Open Font License
1.1. Navigation now exposes its current location, a keyboard skip link and a
stable workspace target.

The Brief leads with the user's career record, documents and growth path before
showing evaluated opportunities. Its new overview cards are links to working
destinations. Existing application, search, profile, document, billing and
monitoring behavior remains intact under the shared theme.

Visual evidence:

- [Desktop Brief](inscription-visuals/morning-brief-desktop.jpg)
- [Mobile Brief](inscription-visuals/morning-brief-mobile.jpg)

The clean final synthetic run passed 44 desktop/mobile usability and functional
cases. The two opt-in screenshot generation cases were intentionally skipped.
The run covers keyboard access, focus visibility, responsive navigation, current
flows without horizontal overflow, error recovery and billing/monitoring gates.
Production web build and TypeScript also pass on Next 15.5.25.

The web production dependency audit reports zero known findings. The extension
production audit has 14 moderate upstream findings through Clerk's Solana chain,
with no high or critical finding. The available forced remediation downgrades the
Clerk extension package to 2.8.11 and was rejected. Mobile has 22 moderate
upstream Expo/Clerk/Solana findings and no high or critical finding; npm reports
no safe automated remediation for that chain.
