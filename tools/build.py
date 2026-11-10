# Baut index.html im Format des Repos: engine.js als eigene Datei, App-Code inline
import os; os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
app=open('src/app.js').read(); ad=open('src/adapter.js').read(); html=open('src/app.html').read()
html=html.replace('<meta name="claude:viewport-fit-sides" content="cover">','<meta name="theme-color" content="#0A0E16">\n<link rel="manifest" href="manifest.webmanifest">\n<link rel="icon" href="icon.svg" type="image/svg+xml">\n<link rel="apple-touch-icon" href="icon-192.png">\n<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">')
html=html.replace('<script>\n/*__ENGINE__*/\n</script>','<script src="engine.js"></script>').replace('/*__APP__*/', ad+'\n'+app)
assert 'src="engine.js"' in html
head='<!doctype html>\n<html lang="de">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>\n'
i=html.index('<div class="app"')
open('index.html','w').write(head+html[:i]+'</head>\n<body>\n'+html[i:]+'\n</body>\n</html>\n')
print('ok')
