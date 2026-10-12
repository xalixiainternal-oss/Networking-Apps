# Xai Network

Pemantau kuota & hotspot untuk Android. Data hanya di perangkat; app **tidak punya izin INTERNET**.
Status: **v0.7** (blokir aplikasi lewat VPN lokal atau Shizuku eksperimental, jadwal blokir, kunci PIN Pengaturan, prediksi sisa kuota, jatah aman per hari, perbandingan minggu, pintasan USSD).

## Build lokal
```
npm ci && npm run build && npx cap sync android
cd android && ./gradlew assembleDebug
```
Butuh **JDK 21** (Capacitor 7). Uji unit JVM: `cd android && ./gradlew testDebugUnitTest`; uji TS: `npm test`.

## Menandatangani APK lewat GitHub Secrets
1. Buat keystore (sekali saja, SIMPAN file & password di tempat aman — kalau hilang, APK tidak bisa di-update):
   `keytool -genkey -v -keystore release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias pantau`
2. Ubah ke base64: Linux/macOS `base64 -w0 release.jks`, Windows PowerShell `[Convert]::ToBase64String([IO.File]::ReadAllBytes("release.jks"))`
3. Di repo GitHub: Settings → Secrets and variables → Actions → New repository secret:
   `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS` (mis. `pantau`), `KEY_PASSWORD`
4. Tanpa secrets, workflow membangun APK **debug** dan menandai Release sebagai pre-release.

## Versi & rilis
Versi diambil dari `version` di `package.json` (versionCode = MAJOR*10000 + MINOR*100 + PATCH). Naikkan sebelum push; tag `vX.Y.Z` dibuat otomatis.
Gaya commit: `Update vX.Y: <ringkasan>`.

## Token warna & kontras (diukur WCAG)
Hex hanya ada di `src/index.css`. Hasil: ink/paper 16.0, ink/pink 14.0, ink/lilac 6.2, paper/royal 5.9, paper/deep 10.9, ink/alert 6.2.
**Tidak lolos:** paper/lilac 2.6 dan ink/royal 2.7. Karena `--grad-1/2/3` melewati lilac, teks di atas gradien tersebut WAJIB berada di dalam `Plate` (pelat solid).
Hanya `--grad-4` (mulai royal) aman untuk teks `--paper` langsung. Teks di atas `--alert` memakai ink.

## Izin per fase
v0.1: `PACKAGE_USAGE_STATS`, `POST_NOTIFICATIONS`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`. Sisanya ditambahkan saat fiturnya ada (lihat onboarding).

## v0.2 — sumber data per versi Android
| Android | Wi-Fi | Seluler | Catatan |
|---|---|---|---|
| 8–9 (API 26–28) | `querySummaryForDevice(TYPE_WIFI)` | **Tidak dicatat** | butuh `subscriberId` → izin telepon, sengaja tidak diminta |
| 10+ (API 29+) | sama | `querySummaryForDevice(TYPE_MOBILE, null)` | `null` = semua SIM digabung (pemilihan SIM data aktif belum ada) |

Riwayat disalin tiap jam ke Room (`usage_hour`, kunci `(hourStart, net)`): penulisan memakai REPLACE sehingga jam yang dihitung ulang
menimpa, bukan menambah → tidak ada hitungan ganda. Pertama kali: 14 hari ke belakang; selanjutnya 2 jam terakhir + jam berjalan.
WorkManager periodik 1 jam (tertunda sistem bila hemat baterai) + `BOOT_COMPLETED`. Siklus tagihan, bucket, persentase, perkiraan: `src/lib/usage.ts` (17 uji).

**Sumber ketidakakuratan yang wajar:** pembagian jam memakai proration bucket sistem; data lama di sistem sudah dikasarkan;
penghitungan operator berbeda dari penghitungan kernel (header/overhead, MMS, roaming); kuota malam belum dipisah.

## v0.3 — catatan data per aplikasi
`querySummary` per jam per jaringan; satu UID bisa punya banyak bucket (metered/roaming/default network) sehingga **dijumlahkan** sebelum disimpan
(versi sebelumnya saling menimpa dan hasilnya terlalu kecil). Rasio foreground/background dibaca saat halaman detail dibuka lewat
`queryDetailsForUidTagState` (Android 9+); kolom `isFg` di Room tidak dipakai lagi. Aplikasi bawaan yang sudah diperbarui (Chrome, YouTube) dianggap aplikasi biasa.

## v0.4 — hotspot, batas, notifikasi
**Hotspot.** Pemakaian tethering dibaca dari bucket `UID_TETHERING` dan disimpan per jam di tabel `tether_hour`. Sudah termasuk dalam total seluler.
Tidak tercatat bila HP/pabrikan tidak mengisi bucket itu, atau bila upstream hotspot bukan data HP ini. Status "hotspot aktif" hanyalah **perkiraan** dari antarmuka jaringan (`ap0`, `swlan0`, `rndis0`, dst.).
**Tidak tersedia untuk aplikasi biasa:** daftar perangkat terhubung/pemakaian per klien, dan membatasi bandwidth hotspot. Penghentian hotspot hanya ditawarkan sebagai aksi opt-in melalui Shizuku; dukungan bergantung versi Android/OEM.

**Batas & peringatan.** Kuota seluler, kuota malam (pemakaian di jam malam dihitung dulu ke kuota malam, sisanya tumpah ke kuota utama), kuota Wi-Fi, batas hotspot harian/siklus, dan batas per aplikasi
(harian/siklus, dihitung dari data seluler). Perhitungan hanya ada di Kotlin (`QuotaEngine` + `QuotaMath`) dan dipakai UI, notifikasi peringatan, dan notifikasi tetap supaya angkanya tidak pernah beda.
Notifikasi 80/90/100% dikirim sekali per ambang per periode; mengubah kuota mengulang dari awal. Pemeriksaan: tiap jam (WorkManager), tiap 5 menit saat layar menyala dan notifikasi tetap aktif, dan saat pengaturan diubah.

**Notifikasi tetap.** Foreground service tipe `specialUse`, berdetak tiap 3 detik hanya saat layar menyala. Bisa dimatikan di Pengaturan. Android 14+ mengizinkan pengguna menggesernya.

**Izin baru:** `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_SPECIAL_USE`. Tetap tanpa `INTERNET`; permission/provider Shizuku dijelaskan di bagian Shizuku.

**Database.** Versi Room 4 dengan migrasi nyata 1→2→3→4: riwayat tidak dihapus saat update (sebelumnya `fallbackToDestructiveMigration`). Migrasi 3→4 menormalkan UID profil dan menggabungkan bucket penggunaan yang merujuk appId sama.

## v0.5 — blokir internet per aplikasi (VPN lokal, tanpa root)
**Cara kerja.** `BlockerVpnService` membuat VPN hanya untuk aplikasi yang sedang harus diblokir (`addAllowedApplication`), dengan rute IPv4 dan IPv6 penuh.
Semua paket mereka masuk ke antarmuka TUN lalu **dibuang**; tidak ada yang diteruskan dan tidak ada server. Aplikasi lain tidak melewati VPN sama sekali,
jadi tidak ada beban kecepatan atau baterai untuk mereka. Himpunan kosong berarti VPN ditutup (VPN tanpa `addAllowedApplication` akan menyedot seluruh trafik HP, jadi itu tidak pernah dibuat).

**Aturan** per aplikasi: blokir di Seluler, di Wi-Fi, dan/atau saat background. Jaringan aktif dipantau lewat `registerDefaultNetworkCallback`; aplikasi di layar lewat polling
`UsageStatsManager.queryEvents` tiap ~2 detik (hanya bila ada aturan background dan layar menyala). VPN dibangun ulang saat himpunan yang diblokir berubah.
Logika "siapa diblokir sekarang" ada di `BlockPolicy.java` (murni, diuji di JVM).

**Blokir otomatis saat batas terlewati** hanya untuk aplikasi yang opsinya dinyalakan pengguna setelah dialog konfirmasi eksplisit. Blokir berlaku sampai akhir periode (harian/siklus) dan bisa dibuka kapan saja.

**Batasan jujur.**
- Memakai SATU slot VPN: tidak bisa bersamaan dengan VPN lain; Android akan menanyakan izin dan bisa mematikan VPN lain. Bila slot diambil, pemblokiran berhenti dan pengguna diberi tahu.
- Paket dibuang, bukan ditolak cepat (tidak ada TCP RST/ICMP), jadi aplikasi tampak menunggu atau timeout.
- "Background" bersifat perkiraan: ada jeda ~2 detik saat berpindah aplikasi, dan layanan latar aplikasi yang sedang tidak di layar tetap dianggap background.
- Setelah restart, Android sering menolak `startService` dari latar. Untuk bertahan, aktifkan **VPN selalu aktif** di pengaturan sistem. Tanpa itu, pemblokiran kembali saat aplikasi dibuka.
- Blokir otomatis dihitung dari data per aplikasi yang disinkronkan (tiap 15 menit saat layar menyala, tiap jam di latar), jadi tidak seketika.
- Tidak ada izin baru di manifest selain deklarasi `BIND_VPN_SERVICE` pada service. Dialog izin VPN dimunculkan sistem saat saklar dinyalakan.

## v0.6 — profil aplikasi, jadwal, PIN, dan radar kuota
**UID lintas profil.** Statistik aplikasi dinormalisasi ke appId Android (UID modulo 100000), sehingga penggunaan aplikasi dengan appId yang sama di profil pengguna/work profile dijumlahkan. Migrasi Room 3→4 juga menggabungkan riwayat lama. Aplikasi berbagi UID ditampilkan/diblokir sebagai satu identitas jaringan.

**Batasan profil kloning.** Aplikasi biasa tidak memperoleh hak untuk menginspeksi atau mengatur paket pada semua profil Android. Pembacaan statistik hanya menggabungkan UID yang dilaporkan `NetworkStatsManager`; VPN hanya dapat memasukkan paket yang terlihat dan diizinkan Android untuk profil layanan. Dukungan penuh untuk kloning OEM atau work profile tidak dapat dijamin pada semua perangkat.

**Jadwal blokir.** Jadwal harian memakai waktu lokal perangkat, batas akhir eksklusif, dan mendukung rentang lintas tengah malam. Saklar utama blokir tetap harus aktif. Layanan mengecek jadwal berkala dan WorkManager mengevaluasi ulang saat sinkron; Android dapat menunda pekerjaan latar saat hemat baterai.

**PIN Pengaturan.** PIN 4–8 digit disimpan sebagai hash bersalt di penyimpanan lokal WebView dan diminta setiap kali halaman Pengaturan dibuka. Ini hanya penghalang pada antarmuka aplikasi, bukan penyimpanan rahasia yang tahan terhadap pengguna dengan akses perangkat, penghapusan data, atau inspeksi aplikasi; tetap gunakan kunci layar Android.

**Radar kuota.** Dashboard menghitung hari perkiraan sampai kuota utama habis dari laju rata-rata seluler pada siklus berjalan. Prediksi bersifat indikatif dan tidak mewakili kuota operator.

## Shizuku — firewall eksperimental dan aksi keselamatan
Shizuku dapat dipilih di Pengaturan sebagai backend atau dipakai otomatis bila siap; VPN lokal tetap jalur fallback. Integrasi menggunakan Shizuku UserService dengan operasi shell allowlist dan argumen terpisah. Dukungan firewall diprobe saat runtime dan membutuhkan perintah Android Connectivity untuk membaca serta mengatur status firewall paket/chain (Android 13+); perangkat OEM dapat menolak atau mengubah perilaku. Setiap aturan dibaca kembali untuk memastikan statusnya benar. Jika operasi tidak berhasil, aturan dibersihkan bila mungkin, VPN lokal dicoba dan notifikasi diberikan.

Pengguna perlu memasang serta menjalankan aplikasi Shizuku, menyetujui izin akses Shizuku, dan juga mengizinkan VPN lokal agar fallback benar-benar dapat bekerja. Aksi mematikan data seluler, menghentikan hotspot, dan menghentikan aplikasi dengan batas terlampaui semuanya **mati secara default** dan memerlukan opt-in. Penghentian aplikasi mengecualikan aplikasi sistem dan launcher; data seluler hanya dimatikan ketika jaringan aktif adalah seluler serta dipulihkan pada siklus baru bila tindakan itu tercatat berhasil. Hotspot perlu dinyalakan kembali manual. Uji pada perangkat dan aplikasi non-esensial sebelum mengandalkannya; status Shizuku tidak menjamin dukungan perintah OEM.

**Izin baru:** dependency Shizuku API/provider dan provider dengan permission lintas pengguna. Tidak ditambahkan izin `INTERNET`; perintah UserService tetap dibatasi allowlist.

## Sumber ketidakakuratan yang wajar
Pembagian jam memakai proration bucket sistem; data lama di sistem sudah dikasarkan; penghitungan operator berbeda dari kernel (header, MMS, roaming);
aplikasi yang sudah dihapus dan proses sistem jatuh ke "Lainnya"; kuota malam dihitung per jam penuh.

## v0.7 — perbaikan build & ketahanan Shizuku
- **Perbaikan build:** `buildFeatures { buildConfig true }` diaktifkan (AGP 8 tidak membuatnya otomatis; `ShizukuClient` memakai `BuildConfig`).
- **Gradle Wrapper:** distribusi `-bin` dan `networkTimeout=60000` agar unduhan tidak timeout di jaringan lambat.
- **`blockApp` aditif:** memblokir satu aplikasi lewat Shizuku tidak lagi membuka blokir aplikasi lain yang sudah tercatat.
- **`ShellOutputParser`:** pembacaan keluaran `cmd connectivity get-*` dipusatkan dan diuji (`ShellOutputParserTest`); bila format tidak dikenali hasilnya `null` dan app kembali ke VPN.
- **Belum teruji di perangkat:** `set-package-networking-enabled` / `set-chain3-enabled` (Android 13+, bisa beda per OEM). Uji manual: aktifkan Shizuku, blokir satu aplikasi, cek `cmd connectivity get-package-networking-enabled <paket>`.
