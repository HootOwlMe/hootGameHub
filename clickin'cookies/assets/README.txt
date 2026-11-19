Drop your own sprite images here (PNG with transparency recommended).

Suggested file names:
  cookie.png      -> the big cookie        (replaces .cookie-art)
  golden.png      -> the golden cookie     (replaces .golden-art)
  cursor.png, grandma.png, farm.png, mine.png, factory.png, bank.png,
  temple.png, wizard.png, shipment.png, alchemy.png, portal.png,
  timemachine.png, antimatter.png, prism.png
                        -> building icons   (replace .sprite--<id> .art)

Then create assets/custom.css (see README.md, "Replacing the placeholder
sprites") and link it in index.html AFTER css/style.css. Example overrides:

  .cookie-art { background: url('assets/cookie.png') center / contain no-repeat; }
  .sprite--cursor .art { background: url('assets/cursor.png') center / contain no-repeat; clip-path: none; }

No game code needs to change.
