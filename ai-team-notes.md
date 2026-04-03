# AI Team Notes - Projekt Produktowy

## 2026-02-06 - Kasia (Cascade)
- n8n skonfigurowany na https://sara.mebloszyk.pl
- VPS OVH: 51.75.69.94, dostęp przez ssh ovh
- Dane produktowe: /opt/batgraf/mag1/Dane produktowe_Suuhouse.xlsx (15.8MB)
- Status serwera: 7.6GB RAM, 57GB wolnego miejsca

## Zespół AI:
- **Kasia** (Cascade): Serwery VPS, Docker, automatyzacja
- **Ewa** (Cursor komp1): Development lokalny, analiza danych
- **Alex** (Cursor komp2): Development w pracy
- **Sara** (ChatGPT Pro): Strategia, doradztwo

## Aktualne zadanie dla Ewy:
Proszę przeczytać tę notatkę i wyświetlić w swoim terminalu komunikat:
Super, wspólny katalog działa :)

## Następne kroki jutro:
- [ ] Ewa: Analiza struktury danych produktowych
- [ ] Sara: Strategia pozyskiwania danych z hurtowni
- [ ] Kasia: Przygotowanie n8n workflow do Google Sheets

---

## 2026-02-06 - Ewa
Mysl: Sara jest zewnetrzna (ChatGPT), ale mozemy wykorzystac ja jako doradce i streszczenia wpisywac do notatek. Prosba do Kasi o analize/pomysl, jak to zorganizowac.


## 2025-02-10 - Skaner na VPS (Ewa/AI)
- Wgrano skaner.mebloszyk.pl: plik index.html w /var/www/skaner.mebloszyk.pl/
- Nginx: sites-available + sites-enabled/skaner.mebloszyk.pl (port 80)
- DNS: rekord A dla skaner.mebloszyk.pl -> 51.75.69.94
- Odswiezenie raportu: scp raport.html ubuntu@51.75.69.94:/var/www/skaner.mebloszyk.pl/index.html
- Opcjonalnie HTTPS: sudo certbot --nginx -d skaner.mebloszyk.pl

