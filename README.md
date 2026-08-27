# QR Layanan Bantuan Teknis Kelas - SBM ITB Jakarta

Sistem web application mandiri untuk mempercepat respon penanganan kendala teknis perkuliahan di ruang kelas SBM ITB Kampus Jakarta berbasis QR Code dan notifikasi WhatsApp Gateway otomatis.

---

## 🌟 Fitur Utama

1. **Privasi 100% Terjaga**: Nomor WhatsApp staf teknis **tidak tampil** pada perangkat dosen atau mahasiswa yang memindai QR Code.
2. **Panggilan Cepat (1-Click Emergency Call)**:
   - Dosen/Mahasiswa cukup scan QR Code di meja kelas $\rightarrow$ Tombol *"PANGGIL BANTUAN SEGERA"*.
   - Format pesan terkirim otomatis: `Mohon bantuan teknis di ruang [Nama Ruangan] SEGERA!`.
   - Opsi kategori cepat: *Proyektor / Layar, Mic / Audio, AC Ruangan, Wi-Fi / Internet, Listrik / Stop Kontak*.
3. **6 Ruangan Terdaftar SBM ITB Jakarta**:
   - `Henk Uno`
   - `Kirana Megatara 1`
   - `Kirana Megatara 2`
   - `Noni Purnomo`
   - `Medco`
   - `12A Room`
4. **Pusat Cetak Kartu QR Code Standee Meja (`/admin/print-qr`)**:
   - Template kartu elegan A5/Standee meja berlogo SBM ITB siap dicetak atau disimpan ke PDF.
5. **Dashboard Monitoring Tiket Real-Time (`/admin`)**:
   - Pemantauan tiket masuk secara live dengan indikator status (*Menunggu, Diproses, Selesai*).
   - Dilengkapi notifikasi audio saat ada panggilan baru masuk.
6. **Integrasi WhatsApp Gateway Gratis (Fonnte Ready)**:
   - Terhubung langsung dengan API Fonnte (Free Tier) dan dilengkapi *Simulation Mode* out-of-the-box.

---

## 🚀 Cara Menjalankan Aplikasi

### 1. Menjalankan Server Lokal
Buka terminal / PowerShell di folder proyek:
```bash
node server.js
```
Aplikasi akan berjalan di:
- **Portal Utama**: [http://localhost:3000](http://localhost:3000)
- **Halaman Panggilan (Contoh Ruang Henk Uno)**: [http://localhost:3000/call?room=Henk%20Uno](http://localhost:3000/call?room=Henk%20Uno)
- **Dashboard Monitoring Staf**: [http://localhost:3000/admin](http://localhost:3000/admin)
- **Pusat Cetak Kartu QR**: [http://localhost:3000/admin/print-qr](http://localhost:3000/admin/print-qr)
- **Pengaturan & Keamanan Sistem**: [http://localhost:3000/admin/settings](http://localhost:3000/admin/settings)

---

## 📲 Panduan Menghubungkan WhatsApp Gateway Gratis (Fonnte)

1. Buka situs [https://fonnte.com](https://fonnte.com) dan daftar akun gratis.
2. Hubungkan nomor WhatsApp bot/staf pengirim dengan scan QR di menu Device Fonnte.
3. Salin **API Token** dari Fonnte.
4. Buka menu **Pengaturan** di aplikasi: [http://localhost:3000/admin/settings](http://localhost:3000/admin/settings)
5. Masukkan Token Fonnte dan Nomor WhatsApp Staf Teknis yang bertugas.
6. Klik **Simpan Pengaturan**, lalu klik **Uji Coba Kirim WA**.

---

## 🖨️ Panduan Mencetak Kartu QR Ruangan

1. Buka halaman [http://localhost:3000/admin/print-qr](http://localhost:3000/admin/print-qr).
2. Jika server diakses via IP jaringan kampus atau domain publik (misal `http://192.168.1.100:3000`), masukkan URL tersebut di kolom *Domain / URL Server*, lalu klik *Update*.
3. Klik tombol **Cetak Semua Kartu (PDF)** untuk mencetak atau menyimpan sebagai PDF.
4. Gunting dan letakkan pada akrilik standee meja pengajar atau tempel di dekat saklar/panel proyektor di tiap ruang kelas.

---

© 2026 SBM ITB Kampus Jakarta
