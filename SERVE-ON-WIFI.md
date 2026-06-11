# Run the app on WiFi (open it from your iPad)

## One-time setup (do this once, ever)

1. In File Explorer, go to the `scripts` folder.
2. Right-click **`allow-firewall-once.ps1`** -> **Run with PowerShell**.
3. Click **Yes** on the Windows admin (UAC) prompt.
   - This opens port 8000 in the firewall for Private (home) WiFi only.

## Every time you want to use the app on the iPad

1. Make sure your **PC and iPad are on the same WiFi**.
2. In the `scripts` folder, right-click **`serve-lan.ps1`** -> **Run with PowerShell**.
   - A window opens and prints the address, e.g. `http://192.168.1.200:8000/`
3. On the iPad, open **Safari** and type that address.
   - Passenger app:   `http://<your-ip>:8000/`
   - Driver dashboard: `http://<your-ip>:8000/editor.html`
4. To stop: click the PowerShell window and press **Ctrl + C** (or just close it).

## Notes
- The IP (`192.168.1.200`) can change after a router restart. The `serve-lan.ps1`
  window always prints the current correct address — use whatever it shows.
- Offline mode / "Add to Home Screen" PWA install will **not** work over WiFi/IP
  (browsers only allow that on `https` or `localhost`). The app still loads and
  runs normally for testing. The real PWA behavior works on the live Netlify site.
- If the iPad can't connect: confirm same WiFi, and that you ran the one-time
  firewall step above.
