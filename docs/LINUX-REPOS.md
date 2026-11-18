# Linux package repositories

With these, MendKit installed on Ubuntu, Mint, Debian, Fedora or openSUSE updates along with everything else
in the system's own Software Updater, instead of downloading a new .deb or .rpm by hand.

## Switching them on (once)
1. On any Linux or Mac computer, make a signing key just for MendKit:
   ```
   gpg --quick-gen-key "MendKit Packages <mendkit@users.noreply.github.com>" rsa4096 sign never
   gpg --armor --export-secret-keys "MendKit Packages" > mendkit-repo-key.asc
   ```
   Press Enter twice when asked for a passphrase to leave it empty, or set one and also add it as
   `LINUX_REPO_GPG_PASSPHRASE`.
2. In GitHub: Settings, Secrets and variables, Actions, New repository secret. Name `LINUX_REPO_GPG_KEY`, value the
   whole contents of `mendkit-repo-key.asc`.
3. Keep `mendkit-repo-key.asc` somewhere safe and offline, then delete the copy on the computer. If it is lost, a new
   key means every user has to add the new key once.

The next published release then also uploads the repositories. Releases without the secret skip this step.

## What a user runs (put this on the website)
Ubuntu, Mint, Debian:
```
curl -fsSL https://pub-a4ba3af629e94c87a8e9aec1b8e48df7.r2.dev/mendkit.gpg | sudo tee /usr/share/keyrings/mendkit.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/mendkit.gpg] https://pub-a4ba3af629e94c87a8e9aec1b8e48df7.r2.dev/apt stable main" | sudo tee /etc/apt/sources.list.d/mendkit.list
sudo apt update && sudo apt install mendkit
```
Fedora:
```
sudo curl -fsSL -o /etc/yum.repos.d/mendkit.repo https://pub-a4ba3af629e94c87a8e9aec1b8e48df7.r2.dev/rpm/mendkit.repo
sudo dnf install mendkit
```
openSUSE:
```
sudo zypper addrepo https://pub-a4ba3af629e94c87a8e9aec1b8e48df7.r2.dev/rpm/mendkit.repo
sudo zypper install mendkit
```

The repositories always hold the newest release. Packages and the repository indexes are signed with the key above;
the "Linux distributions" workflow installs test packages from freshly built repositories on Debian, Ubuntu and Fedora
on every push.
