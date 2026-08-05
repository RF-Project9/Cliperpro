# 🖥️ Panduan Lengkap: Komputer Bekas → Server ViralClip AI

Ubah komputer/laptop bekas Anda menjadi server ViralClip AI yang berjalan 24/7. **Gratis** (tidak ada biaya bulanan), **full control**, dan **IP rumah jauh lebih disukai YouTube** dibanding IP datacenter!

---

## ✅ Kenapa Komputer Bekas = Solusi Terbaik

| Aspek | Railway | VPS Cloud | Komputer Bekas |
|-------|---------|-----------|----------------|
| Biaya | $5/bln | Rp 99k/bln | **Rp 0** (listrik saja) |
| IP type | Datacenter (di-block) | Datacenter | **Residential** ⭐ |
| YouTube block | Sering | Kadang | **Jarang banget** ✅ |
| Control | Terbatas | Root | **Full** ✅ |
| RAM | Terbatas | 2-4GB | **Sesuai komputer Anda** ✅ |
| Bisa install apapun | ❌ | ✅ | ✅ ✅ ✅ |

**Keuntungan utama:** IP rumah (residential) jarang di-block YouTube karena YouTube anggap itu pengguna biasa, bukan bot.

---

## 📋 Persiapan

### Minimum Specs (Sudah Anda Lewati ✅)
- CPU: 2 core (bisa dual-core atau i3)
- RAM: 4GB (8GB lebih bagus)
- Storage: 40GB free
- Internet: Stabil (kecepatan upload 5Mbps+ untuk serving)

### Yang Perlu Disiapkan
1. **Flashdisk 4GB+** (untuk installer Linux)
2. **Akses router** (untuk port forwarding)
3. **Komputer bekas** yang akan jadi server
4. **Komputer/laptop lain** untuk setup awal

---

## 🚀 Step 1: Install Ubuntu Server (Rekomendasi)

### Kenapa Linux, Bukan Windows?

| Aspek | Windows | Ubuntu Server |
|-------|---------|---------------|
| Resource usage | Berat (4GB+ RAM) | Ringan (512MB RAM) |
| Docker support | ❌ Pakai WSL (ribet) | ✅ Native |
| SSH access | ❌ Ribet setup | ✅ Built-in |
| Stability 24/7 | ❌ Update restart | ✅ Bisa jalan tahunan |
| Cost | 💰 License | **Gratis** |

**Saran saya: Install Ubuntu Server 24.04 LTS** (support sampai 2029, stabil, banyak tutorial).

### Cara Install Ubuntu Server

#### A. Download Ubuntu Server ISO
1. Di komputer lain, buka https://ubuntu.com/download/server
2. Download **Ubuntu 24.04 LTS** (file .iso, ~2.5GB)

#### B. Bikin Bootable USB dengan Rufus
1. Download Rufus: https://rufus.ie/
2. Buka Rufus, pilih flashdisk Anda
3. Pilih file ISO Ubuntu yang sudah didownload
4. Klik **Start** → tunggu sampai selesai (5-10 menit)

#### C. Boot Komputer Bekas dari USB
1. Tancapkan flashdisk ke komputer bekas
2. Nyalakan, masuk **BIOS/UEFI** (tekan F2/F12/Del/Esc — tergantung merk)
3. Set **boot priority**: USB flashdisk pertama
4. Save & exit → komputer boot dari USB

#### D. Install Ubuntu Server
Ikuti installer Ubuntu:
1. **Language**: English
2. **Keyboard**: English (US)
3. **Installation type**: Ubuntu Server (minimal, no GUI)
4. **Network**: Pilih WiFi/Ethernet Anda
5. **Storage**: Use entire disk (HATI-HATI: semua data di komputer ini akan hilang!)
6. **Profile setup**:
   - Your name: `admin` (ataa bebas)
   - Server name: `cliperpro` (hostname)
   - Username: `admin`
   - Password: buat password kuat, **CATAT INI!**
7. **SSH Setup**: ✅ Centang "Install OpenSSH server" — **WAJIB**
8. **Snap**: skip (tidak perlu)
9. Klik **Install** → tunggu 10-15 menit
10. Setelah selesai, restart, cabut flashdisk

---

## 🌐 Step 2: Setup Network (IP Statis + Port Forwarding)

### A. Cari IP Komputer Server
Setelah Ubuntu install selesai, login di komputer server:
```bash
ip addr show
```
Catat IP address (mis: `192.168.1.100`).

### B. Set Static IP di Router
1. Buka router admin (biasanya `192.168.1.1` atau `192.168.0.1` di browser)
2. Cari menu **DHCP Reservation** atau **Static IP**
3. Tambahkan MAC address komputer server → set IP static (mis: `192.168.1.100`)
4. Save

### C. Port Forwarding (WAJIB untuk akses dari luar)
Di router, setup **Port Forwarding**:

| External Port | Internal Port | Internal IP | Protocol |
|----------------|---------------|-------------|----------|
| 80 | 80 | 192.168.1.100 | TCP |
| 443 | 443 | 192.168.1.100 | TCP |
| 3000 | 3000 | 192.168.1.100 | TCP (optional, untuk testing) |

> Setiap router beda menu-nya, cari di Google: "port forwarding [merk router Anda]"

### D. Cek IP Public Anda
```bash
curl ifconfig.me
```
Catat IP public ini (mis: `202.123.45.67`) — ini yang Anda akses dari luar rumah.

---

## 🔄 Step 3: Setup Dynamic DNS (Kalau IP Public Berubah)

Kebanyakan ISP rumah memberi **dynamic IP** (berubah tiap restart router). Fix dengan Dynamic DNS gratis:

### Pakai DuckDNS (Gratis, Mudah)
1. Buka https://www.duckdns.org/
2. Login dengan Google/GitHub
3. Buat subdomain (mis: `cliperpro.duckdns.org`)
4. Di komputer server, setup cron job:
   ```bash
   mkdir -p ~/duckdns
   cat > ~/duckdns/duck.sh << 'EOF'
   echo url="https://www.duckdns.org/update?domains=cliperpro&token=YOUR_TOKEN&ip=" | curl -k -o ~/duckdns/duck.log -K -
   EOF
   chmod +x ~/duckdns/duck.sh
   crontab -e
   # Tambahkan baris ini (jalan tiap 5 menit):
   */5 * * * * ~/duckdns/duck.sh >/dev/null 2>&1
   ```

Sekarang Anda bisa akses via `cliperpro.duckdns.org` (auto-update kalau IP berubah).

---

## 🚢 Step 4: Deploy ViralClip AI

### A. SSH ke Server (dari komputer lain)
```bash
ssh admin@192.168.1.100
```
*(atau `ssh admin@cliperpro.duckdns.org` kalau dari luar rumah)*

### B. Jalankan Deploy Script
```bash
curl -fsSL https://raw.githubusercontent.com/RF-Project9/Cliperpro/main/deploy-vps.sh | bash
```

Script akan otomatis:
1. Install Docker
2. Download ViralClip AI dari GitHub
3. Setup PostgreSQL
4. Build aplikasi (5-10 menit)
5. Setup SSL (kalau pakai DuckDNS domain)

### C. Ikuti Prompt
- **OpenAI API Key**: paste key Anda
- **Domain**: `cliperpro.duckdns.org` (ataa IP public kalau tidak pakai DDNS)
- **YouTube cookies**: paste base64 (ataa skip, isi nanti)

---

## 🌍 Step 5: Setup SSL HTTPS (Opsional tapi Recommended)

Kalau pakai DuckDNS, script otomatis setup SSL via Caddy. Kalau tidak pakai domain, akses via HTTP:
```
http://202.123.45.67
```

Kalau pakai DuckDNS + port forwarding 80/443, akses:
```
https://cliperpro.duckdns.org
```

---

## 🔧 Troubleshooting

### Tidak Bisa Diakses dari Luar Rumah
1. Cek port forwarding di router (port 80, 443)
2. Cek firewall server:
   ```bash
   sudo ufw status
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   sudo ufw allow 3000/tcp
   ```
3. Test dari luar (HP pakai data seluler, akses IP public Anda)

### ISP Block Port 80/443
Beberapa ISP Indonesia block port 80/443. Solusi:
1. Pakai port lain (mis: 8443 untuk HTTPS)
2. Atau pakai Cloudflare Tunnel (gratis, bypass port blocking)

**Cloudflare Tunnel setup:**
```bash
# Install cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared

# Login (dapat link untuk auth)
cloudflared tunnel login

# Create tunnel
cloudflared tunnel create cliperpro

# Configure tunnel to route to your app
cloudflared tunnel route dns cliperpro cliperpro.yourdomain.com

# Run tunnel
cloudflared tunnel run cliperpro
```

Cloudflare Tunnel = gratis, tidak perlu port forwarding, dapat HTTPS otomatis, IP tidak terexpose.

### Komputer Mati Listrik
- Set BIOS: "Restore on AC Power Loss" → "Power On" (auto-hidup kalau listrik kembali)
- Pakai UPS kalau sering mati listrik (opsional, ~Rp 300k)

### YouTube Masih Block (Sangat Jarang di IP Rumah)
1. Setup YouTube cookies (lihat panduan sebelumnya)
2. Restart router untuk dapat IP baru (kalau ISP kasih dynamic IP)
3. Pakai VPN di server (optional)

---

## 💰 Estimasi Biaya Total

| Komponen | Biaya |
|----------|-------|
| Komputer bekas | Rp 0 (sudah ada) |
| Listrik (24/7) | ~Rp 50.000-100.000/bulan (tergantung konsumsi) |
| Domain DuckDNS | Rp 0 (gratis) |
| OpenAI API | ~Rp 1.000-5.000 per video |
| **Total** | **~Rp 50.000-100.000/bulan** (listrik saja!) |

Lebih murah dari VPS, dan IP rumah jauh lebih bagus untuk YouTube!

---

## 📋 Checklist Setup

- [ ] Install Ubuntu Server 24.04 LTS
- [ ] Setup SSH access
- [ ] Set static IP di router
- [ ] Setup port forwarding (port 80, 443)
- [ ] Setup DuckDNS (dynamic DNS gratis)
- [ ] Jalankan deploy script
- [ ] Test akses dari luar rumah
- [ ] Setup YouTube cookies
- [ ] Set BIOS auto-restart on power loss
- [ ] Test generate clips + download

---

## 🆘 Kalau Ada Masalah

Paste error/log ke chat saya, saya bantu:
- Install Ubuntu error
- Port forwarding tidak jalan
- Deploy script gagal
- YouTube masih block (sangat jarang di IP rumah)
- SSL tidak setup

Saya siap bantu sampai jalan! 🚀
