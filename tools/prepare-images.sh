#!/bin/bash
# Makes the site's pictures from fresh screenshots: the desktop app (scripts/catalog-shots.mjs → shots-raw)
# and the phone (Grdlabs-AppStore/store-design/shots), JPEG at web size. The phone's status bar is cut off.
cd "$(dirname "$0")/.." || exit 1
mkdir -p img/app img/phone
for n in home invoices reports hr partners team; do
  sips -s format jpeg -s formatOptions 82 -Z 1600 "shots-raw/$n.png" --out "img/app/$n.jpg" >/dev/null && echo "app $n"
done
P=~/Desktop/Grdlabs-AppStore/store-design/shots
for n in owner-home owner-invoices emp-home free-home free-projects; do
  # 1179 x 2556, whole; the page hides the real status bar (time, battery, signal) with a negative top margin.
  sips -s format jpeg -s formatOptions 82 -Z 900 "$P/$n.png" --out "img/phone/$n.jpg" >/dev/null && echo "phone $n"
done
cp ~/Grdlabs-Desktop/artifacts/diwan-desktop/public/grdlabs-logo.svg img/grdlabs-logo.svg
cp ~/Grdlabs-Desktop/artifacts/diwan-desktop/public/grdlabs-app-icon.svg img/grdlabs-app-icon.svg
du -sh img/app img/phone
echo IMAGES-DONE
