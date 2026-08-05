# 🖥️ Panduan Lengkap VPS — ViralClip AI

Deploy ViralClip AI ke VPS Anda sendiri dengan **QRIS** (pembayaran Indonesia).

---

## 📋 Rekomendasi VPS (QRIS, Termurah & Terbaik)

### 🥇 #1 Hostinger VPS KVM 1 — **PILIHAN UTAMA** ⭐⭐⭐⭐⭐
- **Harga**: Rp 59.000/bulan (promo sering diskon)
- **Spec**: 1 vCPU, 4GB RAM, 50GB NVMe SSD, 4TB bandwidth
- **Pembayaran**: ✅ QRIS, Bank Transfer, GoPay, OVO, DANA
- **Lokasi**: Singapore (paling dekat Indonesia) atau Indonesia
- **Link**: https://www.hostinger.co.id/vps-hosting
- **Kenapa**: Termurah, support Indonesia bagus, IP Singapore lumayan bersih

### 🥈 #2 Domainesia VPS
- **Harga**: Rp 50.000/bulan
- **Spec**: 1 vCPU, 2GB RAM, 40GB SSD
- **Pembayaran**: ✅ QRIS, Bank Transfer
- **Link**: https://domainesia.com/vps/
- **Kenapa**: Provider lokal, support Bahasa Indonesia

### 🥉 #3 Niagahoster VPS
- **Harga**: Rp 99.000/bulan
- **Spec**: 1 vCPU, 2GB RAM, 30GB SSD
- **Pembayaran**: ✅ QRIS, Bank Transfer, e-wallet
- **Link**: https://niagahoster.co.id/vps-hosting
- **Kenapa**: Tidak perlu kartu kredit, garansi uang kembali

### #4 Dewaweb VPS
- **Harga**: Rp 195.000/bulan (lebih mahal tapi premium)
- **Pembayaran**: ✅ QRIS
- **Link**: https://www.dewaweb.com/vps-cloud-hosting/

---

## 🎯 Rekomendasi Saya: Hostinger VPS KVM 1

**Kenapa Hostinger?**
1. **Termurah** (Rp 59k/bln) dengan spec bagus (4GB RAM)
2. **QRIS** support paling lengkap
3. **Singapore datacenter** — IP lebih bersih dari Railway, lebih dekat ke Indonesia
4. **Setup mudah** — ada panel sendiri
5. **Support Bahasa Indonesia** 24/7

---

## 📦 Cara Pembelian Hostinger dengan QRIS

### Step 1: Daftar & Beli
1. Buka https://www.hostinger.co.id/vps-hosting
2. Pilih plan **KVM 1** (Rp 59.000/bulan)
3. Pilih durasi: **1 bulan** (coba dulu) atau **12 bulan** (lebih murah)
4. Lokasi server: **Singapore** ⚠️ PENTING
5. Klik **Add to cart** → **Checkout**
6. Buat akun Hostinger (email + password)
7. Pilih pembayaran: **QRIS** atau **GoPay** atau **OVO**

### Step 2: Bayar dengan QRIS
1. Anda akan lihat QR code
2. Buka aplikasi e-wallet Anda (GoPay/OVO/DANA/ShopeePay)
3. Scan QR code tersebut
4. Bayar Rp 59.000
5. Tunggu konfirmasi (biasanya 1-5 menit)

### Step 3: Setup VPS
1. Login ke https://hpanel.hostinger.co.id
2. Buka tab **VPS** → klik VPS Anda
3. Pilih **OS**: **Ubuntu 24.04** (rekomendasi)
4. Tunggu 5-10 menit sampai VPS aktif
5. Catat:
   - **IP Address** (mis: 123.45.67.89)
   - **Username**: root
   - **Password**: yang Hostinger kasih

---

## 🔧 Setup ViralClip AI di VPS (Langkah Demi Langkah)

### Step 1: Connect ke VPS via SSH

**Windows 10/11** (buka Command Prompt/PowerShell):
```bash
ssh root@123.45.67.89
```
*(ganti 123.45.67.89 dengan IP VPS Anda)*

**macOS/Linux** (buka Terminal):
```bash
ssh root@123.45.67.89
```

Masukkan password yang Hostinger kasih saat diminta.

### Step 2: Download & Jalankan Deploy Script

Setelah login ke VPS, jalankan **1 perintah** ini:

```bash
curl -fsSL https://raw.githubusercontent.com/RF-Project9/Cliperpro/main/deploy-vps.sh | bash
```

Script ini otomatis:
1. Install Docker
2. Download kode ViralClip AI dari GitHub
3. Setup database PostgreSQL
4. Build & jalankan aplikasi
5. Setup SSL otomatis (kalau ada domain)

### Step 3: Ikuti Prompt Script

Script akan minta:
1. **OpenAI API Key** → paste key Anda (`sk-...`)
2. **Domain name** → kosongkan dulu (ataa isikan kalau sudah punya domain)
3. **YouTube cookies** → paste base64 cookies (atau kosongkan, isi nanti via env)

### Step 4: Tunggu Build Selesai

Build butuh **5-10 menit** (install dependencies + compile).

Setelah selesai, Anda lihat:
```
✓ DEPLOYMENT COMPLETE!
Your app is live at: http://123.45.67.89
```

### Step 5: Buka Aplikasi

Buka browser → akses:
```
http://123.45.67.89
```

Halaman ViralClip AI harusnya muncul! 🎉

---

## 🌐 Setup Domain (Opsional, Tapi Recommended)

### Beli Domain (.com ~Rp 150k/tahun, .id ~Rp 300k/tahun)

1. Beli domain di Hostinger/Niagahoster/Domainesia (QRIS)
2. Di panel domain, setup **DNS A Record**:
   - **Name/Host**: `@` (ataa kosongkan)
   - **Value/Points to**: `123.45.67.89` (IP VPS Anda)
   - **TTL**: 3600

3. Tunggu 5-30 menit untuk DNS propagate

4. Update Caddyfile di VPS:
```bash
cd /opt/cliperpro
nano Caddyfile
```
Ganti `localhost` dengan domain Anda, mis: `cliperpro.yourdomain.com`

5. Restart Caddy:
```bash
docker compose restart caddy
```

6. Caddy otomatis setup SSL (Let's Encrypt) dalam 1-2 menit

7. Akses via HTTPS:
```
https://cliperpro.yourdomain.com
```

---

## ⚠️ Tentang YouTube Download di VPS

### Apakah VPS Singapore Hostinger bisa download YouTube?
**Kemungkinan besar YA** — IP VPS Hostinger Singapore jauh lebih bersih dari Railway. Tapi tidak 100% guarantee.

**Kalau masih kena block, 3 opsi:**

1. **Setup YouTube cookies** (sama seperti Railway):
   - Export cookies dari browser
   - Set env var `YOUTUBE_COOKIES` di `/opt/cliperpro/.env`
   - Restart: `docker compose restart app`

2. **Ganti IP VPS** (kalau IP Anda kena flag):
   - Hostinger kasih 1 IP gratis, tapi bisa request ganti via support ticket
   - Atau pilih lokasi datacenter lain (US/EU)

3. **Tambah residential proxy** (kalau perlu):
   - Edit `/opt/cliperpro/.env`, tambah `HTTP_PROXY=...`
   - Restart app

---

## 📋 Commands Berguna di VPS

```bash
# Masuk ke folder aplikasi
cd /opt/cliperpro

# Lihat log aplikasi (live)
docker compose logs -f app

# Restart aplikasi
docker compose restart app

# Stop semua services
docker compose down

# Update ke versi terbaru dari GitHub
git pull && docker compose up -d --build

# Edit .env (misal untuk tambah cookies)
nano .env
docker compose restart app

# Lihat status semua services
docker compose ps

# Cek penggunaan disk/RAM
docker stats
df -h
free -m
```

---

## 🆘 Kalau Ada Masalah

### Aplikasi tidak bisa diakses
```bash
# Cek apakah app jalan
docker compose ps
# Kalau status "Exit", cek log:
docker compose logs app
```

### Database error
```bash
# Cek DB status
docker compose logs db
# Restart DB
docker compose restart db
```

### Video download gagal
```bash
# Cek log saat download
docker compose logs -f app | grep video
# Set YouTube cookies (lihat panduan di chat sebelumnya)
nano /opt/cliperpro/.env
# Tambah: YOUTUBE_COOKIES=<base64-string>
docker compose restart app
```

### SSL tidak jalan (kalau pakai domain)
```bash
# Pastikan domain sudah pointing ke VPS
dig cliperpro.yourdomain.com
# Harus return IP VPS Anda. Kalau belum, tunggu DNS propagate
# Cek Caddy log
docker compose logs caddy
```

---

## 💰 Estimasi Biaya Total

| Item | Harga |
|------|-------|
| VPS Hostinger KVM 1 | Rp 59.000/bulan |
| Domain .com (opsional) | Rp 150.000/tahun (~Rp 12.500/bulan) |
| OpenAI API | ~Rp 1.000-5.000 per video (tergantung panjang) |
| **Total** | **~Rp 75.000/bulan** (dengan domain) |

---

## ❓ Yang TIDAK Bisa Saya Lakukan

Saya tidak bisa:
- ❌ Login ke VPS Anda (saya di sandbox terisolasi)
- ❌ Membeli VPS untuk Anda
- ❌ Akses panel Hostinger Anda

Tapi saya **BISA**:
- ✅ Bantu debug via chat kalau ada error (paste log ke saya)
- ✅ Update kode di GitHub (auto-deploy ke VPS via `git pull`)
- ✅ Berikan command yang Anda copy-paste ke VPS

---

## 🎯 Langkah Selanjutnya

1. **Beli VPS Hostinger** (QRIS) — https://www.hostinger.co.id/vps-hosting
2. **Setup VPS** (Ubuntu 24.04, Singapore)
3. **SSH ke VPS**, jalankan deploy script
4. **Test aplikasi** → kalau ada error, paste log ke saya

Saya akan bantu sampai jalan! 🚀
