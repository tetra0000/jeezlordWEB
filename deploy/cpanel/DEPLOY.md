# Hosting Jeezlord at jackbulmer.co.uk/jeezlord/ — beginner walkthrough

This guide assumes you have NEVER used the advanced parts of cPanel/WHM before.
Every command is copy-paste. Take it one section at a time.

## What we're actually doing (the 30-second version)

Jeezlord isn't a normal website — it's a program that has to run **all the time**
(the game world keeps simulating even when nobody's online) and uses a live
**WebSocket** connection. Normal cPanel website hosting can't do that. So we:

1. Install **Node** (the thing that runs the game) on the server.
2. Upload the game's files.
3. Set it up as a **service** so the server keeps it running 24/7.
4. Tell your existing website to forward `jackbulmer.co.uk/jeezlord/` to the
   game, without touching the rest of your site.

You need your server's **root login** (the Namecheap welcome email has it, or
reset it in your Namecheap dashboard under your VPS).

---

## Part 1 — Open a command window on the server (no SSH setup needed)

WHM has a built-in terminal in the browser. That's the easiest way in.

1. Go to **`https://jackbulmer.co.uk:2087`** and log in as **root**.
   (If the browser warns about the certificate, that's normal for the :2087
   admin port — click through it.)
2. In the search box at the top-left, type **Terminal** and click it.
3. Click the checkbox to accept the warning. You now have a black command window
   running **as root** (full admin). This is where you'll paste commands.

Keep this tab open — we'll come back to it. Anything in a grey code box below
gets pasted here unless I say otherwise.

---

## Part 2 — Find your cPanel username (you'll reuse it a lot)

Your main website lives in one cPanel account, which has a short username. Find it:

In the Terminal, paste this:

    grep -rl jackbulmer.co.uk /etc/apache2/conf.d/userdata 2>/dev/null

It prints a path like `/etc/apache2/conf.d/userdata/std/2_4/**jackb**/jackbulmer.co.uk/...`
— the bold part (`jackb` in this example) is your username. If nothing prints,
open WHM » **List Accounts** and read the "User" column for jackbulmer.co.uk.

Now tell the Terminal your username so the rest of the commands fill in
automatically. **Replace `jackb` with your real username** and paste:

    CPUSER=jackb

(Do this once. If you close the Terminal and come back, run it again.)

---

## Part 3 — Install Node

Paste this. It downloads and installs Node 24:

    curl -fsSL https://rpm.nodesource.com/setup_24.x | bash -
    yum install -y nodejs || dnf install -y nodejs
    node -v

The last line should print something like `v24.x.x`. If it does, Node is ready.

---

## Part 4 — Upload the game files

The game lives in a folder on your PC. We'll zip it, upload it through cPanel's
File Manager (drag-and-drop), and unzip it on the server.

**On your Windows PC:**

1. Open the `world-sites\jeezlord` folder.
2. If there's a `node_modules` folder inside, **delete it** (it's huge and
   Windows-specific — the server rebuilds its own). Also delete any `data`
   folder if present (that's a local test world).
3. Select everything else, right-click → **Send to → Compressed (zipped)
   folder**. You'll get a `jeezlord.zip`.

**Upload it:**

4. Go to **`https://jackbulmer.co.uk:2083`** and log into the **cPanel account**
   (username from Part 2, and its password — different from the root password;
   if you don't know it, reset it in WHM » List Accounts » the wrench/Change
   Password).
5. Open **File Manager**. You'll be in the account's home folder.
6. Click **Upload**, drag `jeezlord.zip` in, wait for 100%, go back.
7. Right-click `jeezlord.zip` → **Extract** → extract into the current folder.
   You should now see a `jeezlord` folder.

(If the extract makes a nested folder like `jeezlord/jeezlord`, that's fine —
just note the real path; the commands below assume `/home/USER/jeezlord`
containing `package.json` directly. You can check in the next step.)

---

## Part 5 — Build and prepare the game (back in the root Terminal)

Paste these one block at a time:

    cd /home/$CPUSER/jeezlord
    ls package.json        # must print "package.json" — if "No such file", you're in the wrong folder

If that printed `package.json`, continue:

    rm -rf node_modules
    npm ci
    npm run build
    mkdir -p data
    chown -R $CPUSER:$CPUSER /home/$CPUSER/jeezlord

`npm ci` and `npm run build` take a minute or two and print a lot — that's
normal. As long as you don't see a red `npm error` at the very end, it worked.

---

## Part 6 — Make it run 24/7 (the service)

This installs the service file, fills in your username, and starts the game:

    cp /home/$CPUSER/jeezlord/deploy/cpanel/jeezlord.service /etc/systemd/system/jeezlord.service
    sed -i "s/CPUSER/$CPUSER/g" /etc/systemd/system/jeezlord.service
    systemctl daemon-reload
    systemctl enable --now jeezlord
    systemctl status jeezlord --no-pager

In the status output, look for **`active (running)`** in green. Then confirm the
game is actually answering on the server:

    curl -s http://127.0.0.1:8081/ | head -n 3

You should see HTML (`<!doctype html>` …). If so, the game is running — it's just
not reachable from the web yet. That's the last part.

(Handy later: `journalctl -u jeezlord -f` shows live logs; press Ctrl+C to stop
watching. `systemctl restart jeezlord` restarts it.)

---

## Part 7 — Connect your domain's /jeezlord to the game

Right now your website (Apache) doesn't know about the game. We add a small
config snippet that forwards `/jeezlord/` to it. cPanel has a special folder for
these snippets so they don't get wiped when cPanel regenerates its config.

First make sure the WebSocket-forwarding module is installed:

    httpd -M | grep -q proxy_wstunnel && echo "OK already installed" || yum install -y ea-apache24-mod_proxy_wstunnel

Now install the snippet into both the http and https config folders, and reload
Apache:

    for T in std ssl; do
      D=/etc/apache2/conf.d/userdata/$T/2_4/$CPUSER/jackbulmer.co.uk
      mkdir -p "$D"
      cp /home/$CPUSER/jeezlord/deploy/cpanel/jeezlord.conf "$D/jeezlord.conf"
    done
    /scripts/ensure_vhost_includes --user=$CPUSER
    /scripts/rebuildhttpdconf
    systemctl restart httpd
    echo "done"

When it prints `done`, you're live.

---

## Part 8 — Try it

Open **`https://jackbulmer.co.uk/jeezlord/`** in your browser.

The trailing slash matters — `/jeezlord` alone will auto-redirect to
`/jeezlord/`, but always link people to the slash version.

You should see the Jeezlord login screen, and the little status text should reach
**"open"** (that means the live game connection succeeded). Register an account
and you're playing on your own server. Your existing site at `jackbulmer.co.uk`
is untouched.

---

## If something's wrong

- **Login screen loads but status stays "connecting"/"closed":** the WebSocket
  isn't getting through. Re-run the `httpd -M | grep proxy_wstunnel` check from
  Part 7 — if it doesn't say installed, install it and redo Part 7.
- **404 / cPanel default page at /jeezlord/:** the snippet didn't apply. Re-run
  the Part 7 block, and double-check `$CPUSER` is set (`echo $CPUSER`).
- **Service won't start (`systemctl status` shows "failed"):** see the error with
  `journalctl -u jeezlord -n 50 --no-pager`. Most common cause is the path —
  confirm `/home/$CPUSER/jeezlord/dist/server/main.js` exists (`ls` it); if not,
  the build (Part 5) didn't finish.
- **Nothing on http://127.0.0.1:8081 in Part 6:** the build folder is wrong or
  empty; re-do Part 5.

---

## Updating the game later

When you change the code, re-zip and re-upload (Part 4, overwrite the folder),
then in the root Terminal:

    cd /home/$CPUSER/jeezlord && npm ci && npm run build && chown -R $CPUSER:$CPUSER . && systemctl restart jeezlord

The game world is saved in `/home/$CPUSER/jeezlord/data/world.db` and survives
restarts. To back it up, copy that file (and the `world.db-wal` next to it).
