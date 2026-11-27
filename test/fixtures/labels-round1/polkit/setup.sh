#!/bin/bash
set -euo pipefail
if [[ $EUID == 0 ]]; then elevate=(); elif [[ -t 0 ]]; then elevate=(sudo); else elevate=(pkexec); fi
installs='/usr/bin/install -o root -g root -m 755 -D "$1" /usr/local/bin/foo-root-helper && /usr/bin/install -o root -g root -m 644 -D "$2" /usr/share/polkit-1/actions/local.foo.policy'
if [[ ${1:-} == '--passwordless' ]]; then
  rule=$(mktemp)
  cat > "$rule" <<RULE
polkit.addRule(function(action, subject) {
  if (action.id === "local.foo.modify" && subject.user === "me") {
    return polkit.Result.YES;
  }
});
RULE
  installs+=' && /usr/bin/install -o root -g root -m 644 -D "$3" /etc/polkit-1/rules.d/49-local.foo.rules'
fi
"${elevate[@]}" /usr/bin/bash -c "$installs" foo-setup "setup/foo-root-helper" "setup/local.foo.policy" "$rule"
