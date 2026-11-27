import QtQuick
import Quickshell.Io
Item {
  Process { id: fetcher; command: ["bash", "-c", "curl -s https://wttr.in/?format=3"] }
  Process { id: notify; command: ["notify-send", "Weather"] }
}
