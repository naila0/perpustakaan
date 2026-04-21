import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.4.0/firebase-app.js';
import { getFirestore, collection, doc, getDocs, getDoc, addDoc, deleteDoc, updateDoc, query, where, orderBy, Timestamp } from 'https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js';

// Konfigurasi Firebase
const firebaseConfig = {
    apiKey: "AIzaSyCgSS-chZUH5T47nhRNeK6jYDnGZK_TQSA",
    authDomain: "insan-cemerlang-d6eb1.firebaseapp.com",
    projectId: "insan-cemerlang-d6eb1",
    storageBucket: "insan-cemerlang-d6eb1.appspot.com",
    messagingSenderId: "162904381844",
    appId: "1:162904381844:web:dd88782fdcc494c9ac1781",
    measurementId: "G-1RSX6TCWZ2"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const bukuRef = collection(db, "buku_perpustakaan");
const anggotaRef = collection(db, "anggota_perpus");
const peminjamanRef = collection(db, "peminjaman_buku");

let currentUser = { role: '', username: '', userId: '' };
const DENDA_PER_HARI = 2000;

// Helper functions
function hitungDendaDanTerlambat(tanggalJatuhTempo, tanggalKembali = null) {
    if (!tanggalJatuhTempo) return { hariTerlambat: 0, denda: 0 };
    const jatuhTempoDate = new Date(tanggalJatuhTempo.seconds * 1000);
    const now = tanggalKembali ? new Date(tanggalKembali.seconds * 1000) : new Date();
    if (now <= jatuhTempoDate) return { hariTerlambat: 0, denda: 0 };
    const hariTerlambat = Math.ceil((now - jatuhTempoDate) / (1000 * 60 * 60 * 24));
    return { hariTerlambat, denda: hariTerlambat * DENDA_PER_HARI };
}

function formatRupiah(angka) { return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(angka); }
function formatDate(timestamp) { if(!timestamp) return '-'; return new Date(timestamp.seconds * 1000).toLocaleDateString('id-ID'); }
function toTimestamp(dateStr) { if(!dateStr) return null; return Timestamp.fromDate(new Date(dateStr)); }

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    }).replace(/["']/g, function(m) {
        if (m === '"') return '&quot;';
        if (m === "'") return '&#39;';
        return m;
    });
}

// Modal
function showModal(title, contentHtml) {
    const modal = document.getElementById('dynamicModal');
    const modalInner = document.getElementById('modalInner');
    modalInner.innerHTML = `<h3 style="margin-bottom:16px;">${title}</h3>${contentHtml}<div style="display:flex; justify-content:flex-end; gap:12px; margin-top:24px;"><button class="btn" id="modalCloseBtn">Batal</button><button class="btn btn-primary" id="modalConfirmBtn">Simpan</button></div>`;
    modal.style.display = 'flex';
    return new Promise((resolve) => {
        const confirmBtn = document.getElementById('modalConfirmBtn');
        const closeBtn = document.getElementById('modalCloseBtn');
        const onConfirm = () => { modal.style.display = 'none'; cleanup(); resolve(true); };
        const onCancel = () => { modal.style.display = 'none'; cleanup(); resolve(false); };
        const cleanup = () => {
            confirmBtn.removeEventListener('click', onConfirm);
            closeBtn.removeEventListener('click', onCancel);
        };
        confirmBtn.addEventListener('click', onConfirm);
        closeBtn.addEventListener('click', onCancel);
    });
}

// Password toggle
function initPasswordToggles() {
    document.querySelectorAll('.toggle-password').forEach(btn => {
        btn.removeEventListener('click', handleToggle);
        btn.addEventListener('click', handleToggle);
    });
}
function handleToggle(e) {
    const btn = e.currentTarget;
    const input = document.getElementById(btn.getAttribute('data-target'));
    if(input) {
        const type = input.type === 'password' ? 'text' : 'password';
        input.type = type;
        btn.querySelector('i').classList.toggle('fa-eye');
        btn.querySelector('i').classList.toggle('fa-eye-slash');
    }
}

// Load data
async function loadBuku(filter = '') {
    const snapshot = await getDocs(query(bukuRef, orderBy("judul")));
    let data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    if(filter) data = data.filter(b => b.judul?.toLowerCase().includes(filter) || b.penerbit?.toLowerCase().includes(filter) || b.jenis?.toLowerCase().includes(filter));
    return data;
}
async function loadAnggota(filter='') {
    const snapshot = await getDocs(anggotaRef);
    let data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    if(filter) data = data.filter(a => a.nama?.toLowerCase().includes(filter) || a.kelas?.toLowerCase().includes(filter));
    return data;
}
async function loadPeminjaman(role, userId=null) {
    let q = peminjamanRef;
    if(role === 'user' && userId) q = query(peminjamanRef, where("userId", "==", userId));
    const snapshot = await getDocs(q);
    let loans = [];
    for(const docSnap of snapshot.docs) {
        const data = docSnap.data();
        const bookDoc = await getDoc(doc(bukuRef, data.bukuId));
        loans.push({ id: docSnap.id, ...data, judulBuku: bookDoc.exists() ? bookDoc.data().judul : 'Tidak diketahui' });
    }
    return loans;
}

// Perpanjang & Kembali
async function perpanjangPeminjaman(loanId) {
    const loanDoc = await getDoc(doc(peminjamanRef, loanId));
    const loanData = loanDoc.data();
    if(loanData.status === 'Dikembalikan') return alert("Buku sudah dikembalikan, tidak bisa diperpanjang!");
    const currentDue = loanData.tanggalJatuhTempo.toDate();
    const minDate = new Date(currentDue);
    minDate.setDate(minDate.getDate() + 1);
    const defaultDate = new Date(currentDue);
    defaultDate.setDate(defaultDate.getDate() + 7);
    const yyyy = defaultDate.getFullYear();
    const mm = String(defaultDate.getMonth() + 1).padStart(2, '0');
    const dd = String(defaultDate.getDate()).padStart(2, '0');
    const defaultDateStr = `${yyyy}-${mm}-${dd}`;
    const html = `<div class="form-group"><label>📅 Tanggal Jatuh Tempo Baru (Manual)</label><input type="date" id="newDueDate" value="${defaultDateStr}" min="${minDate.toISOString().split('T')[0]}"><div class="date-note">* Minimal 1 hari setelah jatuh tempo saat ini (${currentDue.toLocaleDateString('id-ID')})</div></div>`;
    const confirmed = await showModal("Perpanjang Buku (Manual Date)", html);
    if(!confirmed) return;
    const newDueDateStr = document.getElementById('newDueDate').value;
    if(!newDueDateStr) return alert("Harap pilih tanggal jatuh tempo baru.");
    const newDueDateObj = new Date(newDueDateStr);
    if(newDueDateObj <= currentDue) return alert("Tanggal baru harus lebih dari jatuh tempo saat ini!");
    const newTimestamp = Timestamp.fromDate(newDueDateObj);
    await updateDoc(doc(peminjamanRef, loanId), { tanggalJatuhTempo: newTimestamp, perpanjangKe: (loanData.perpanjangKe || 0) + 1 });
    alert(`Perpanjangan berhasil! Jatuh tempo baru: ${newDueDateObj.toLocaleDateString('id-ID')}`);
}

async function prosesKembali(loanId, bukuId, isUser = false, userIdForDenda = null) {
    const loanDoc = await getDoc(doc(peminjamanRef, loanId));
    const loanData = loanDoc.data();
    if(loanData.status === 'Dikembalikan') return alert("Buku sudah dikembalikan!");
    const todayStr = new Date().toISOString().split('T')[0];
    const html = `<div class="form-group"><label>📆 Tanggal Pengembalian (Manual)</label><input type="date" id="manualReturnDate" value="${todayStr}"><div class="date-note">* Pilih tanggal sesuai kondisi riil. Denda akan dihitung otomatis.</div></div>`;
    const confirmed = await showModal("Konfirmasi Pengembalian Buku", html);
    if(!confirmed) return;
    const selectedDate = document.getElementById('manualReturnDate').value;
    if(!selectedDate) return alert("Tanggal pengembalian harus dipilih!");
    const tglKembaliTimestamp = Timestamp.fromDate(new Date(selectedDate));
    const { denda } = hitungDendaDanTerlambat(loanData.tanggalJatuhTempo, tglKembaliTimestamp);
    const targetUserId = userIdForDenda || loanData.userId;
    if(denda > 0) {
        const anggotaDoc = await getDoc(doc(anggotaRef, targetUserId));
        const dendaLama = anggotaDoc.data()?.totalDenda || 0;
        await updateDoc(doc(anggotaRef, targetUserId), { totalDenda: dendaLama + denda });
        alert(`⚠️ Terlambat! Denda ${formatRupiah(denda)} ditambahkan ke akun peminjam.`);
    }
    await updateDoc(doc(peminjamanRef, loanId), { status: 'Dikembalikan', tglKembali: tglKembaliTimestamp });
    const bookDoc = await getDoc(doc(bukuRef, bukuId));
    if(bookDoc.exists()) await updateDoc(doc(bukuRef, bukuId), { stok: (bookDoc.data().stok || 0) + 1 });
    alert("✅ Buku berhasil dikembalikan dengan tanggal manual.");
}

async function hapusPeminjaman(loanId, bukuId, status) {
    if(!confirm("⚠️ Hapus transaksi ini? Tindakan tidak dapat dibatalkan.")) return;
    if(status !== 'Dikembalikan') {
        const bookDoc = await getDoc(doc(bukuRef, bukuId));
        if(bookDoc.exists()) await updateDoc(doc(bukuRef, bukuId), { stok: (bookDoc.data().stok || 0) + 1 });
    }
    await deleteDoc(doc(peminjamanRef, loanId));
    alert("Transaksi berhasil dihapus.");
    await renderAdminDashboard();
}

// CRUD Buku
async function tambahBuku() {
    const html = `<div class="form-group"><label>Judul</label><input id="judulBuku"></div><div class="form-group"><label>Penerbit</label><input id="penerbitBuku"></div><div class="form-group"><label>Jenis</label><select id="jenisBuku"><option>Fiksi</option><option>Non Fiksi</option><option>Pendidikan</option><option>Teknologi</option><option>Lainnya</option></select></div><div class="form-group"><label>Stok</label><input id="stokBuku" type="number" value="1"></div>`;
    if(await showModal("Tambah Buku", html)) {
        const judul = document.getElementById('judulBuku').value.trim();
        if(judul) await addDoc(bukuRef, { judul, penerbit: document.getElementById('penerbitBuku').value, jenis: document.getElementById('jenisBuku').value, stok: parseInt(document.getElementById('stokBuku').value) });
        await renderAdminDashboard();
    }
}

async function editBuku(id) {
    const docSnap = await getDoc(doc(bukuRef, id));
    if(!docSnap.exists()) return alert("Data buku tidak ditemukan!");
    const d = docSnap.data();
    const escapedJudul = escapeHtml(d.judul || '');
    const escapedPenerbit = escapeHtml(d.penerbit || '');
    const selectedJenis = d.jenis || 'Fiksi';
    const stokValue = d.stok || 0;
    const html = `<div class="form-group"><label>Judul</label><input id="judulBuku" value="${escapedJudul}"></div><div class="form-group"><label>Penerbit</label><input id="penerbitBuku" value="${escapedPenerbit}"></div><div class="form-group"><label>Jenis</label><select id="jenisBuku"><option ${selectedJenis === 'Fiksi' ? 'selected' : ''}>Fiksi</option><option ${selectedJenis === 'Non Fiksi' ? 'selected' : ''}>Non Fiksi</option><option ${selectedJenis === 'Pendidikan' ? 'selected' : ''}>Pendidikan</option><option ${selectedJenis === 'Teknologi' ? 'selected' : ''}>Teknologi</option><option ${selectedJenis === 'Lainnya' ? 'selected' : ''}>Lainnya</option></select></div><div class="form-group"><label>Stok</label><input id="stokBuku" type="number" value="${stokValue}"></div>`;
    const confirmed = await showModal("Edit Buku", html);
    if(!confirmed) return;
    const judulBaru = document.getElementById('judulBuku').value.trim();
    if(!judulBaru) return alert("Judul tidak boleh kosong!");
    await updateDoc(doc(bukuRef, id), {
        judul: judulBaru,
        penerbit: document.getElementById('penerbitBuku').value,
        jenis: document.getElementById('jenisBuku').value,
        stok: parseInt(document.getElementById('stokBuku').value) || 0
    });
    alert("Buku berhasil diperbarui!");
    await renderAdminDashboard();
}

async function hapusBuku(id) { if(confirm("Hapus buku?")) { await deleteDoc(doc(bukuRef, id)); await renderAdminDashboard(); } }

// CRUD Anggota
async function tambahAnggota() {
    const html = `<div class="form-group"><label>Nama</label><input id="namaAnggota"></div><div class="form-group"><label>Kelas</label><input id="kelasAnggota"></div><div class="form-group"><label>Password</label><div class="password-wrapper"><input type="password" id="passwordAnggota" value="123456"><button type="button" class="toggle-password" data-target="passwordAnggota"><i class="fas fa-eye-slash"></i></button></div></div>`;
    if(await showModal("Tambah Anggota", html)) {
        initPasswordToggles();
        const nama = document.getElementById('namaAnggota').value.trim();
        if(nama) await addDoc(anggotaRef, { nama, kelas: document.getElementById('kelasAnggota').value, password: document.getElementById('passwordAnggota').value, tanggalDaftar: new Date().toLocaleDateString(), totalDenda: 0 });
        await renderAdminDashboard();
    }
}

async function editAnggota(id) {
    const docSnap = await getDoc(doc(anggotaRef, id));
    if(!docSnap.exists()) return alert("Data anggota tidak ditemukan!");
    const d = docSnap.data();
    const escapedNama = escapeHtml(d.nama || '');
    const escapedKelas = escapeHtml(d.kelas || '');
    const html = `<div class="form-group"><label>Nama</label><input id="namaAnggota" value="${escapedNama}"></div><div class="form-group"><label>Kelas</label><input id="kelasAnggota" value="${escapedKelas}"></div><div class="form-group"><label>Password Baru</label><div class="password-wrapper"><input type="password" id="passwordAnggota" placeholder="Kosongkan jika tidak ubah"><button type="button" class="toggle-password" data-target="passwordAnggota"><i class="fas fa-eye-slash"></i></button></div><div class="date-note">*Isi hanya jika ingin mengganti password</div></div>`;
    const confirmed = await showModal("Edit Anggota", html);
    if(!confirmed) return;
    const namaBaru = document.getElementById('namaAnggota').value.trim();
    if(!namaBaru) return alert("Nama tidak boleh kosong!");
    const updates = { nama: namaBaru, kelas: document.getElementById('kelasAnggota').value };
    const passwordBaru = document.getElementById('passwordAnggota').value;
    if(passwordBaru) {
        if(passwordBaru.length < 4) return alert("Password minimal 4 karakter!");
        updates.password = passwordBaru;
    }
    await updateDoc(doc(anggotaRef, id), updates);
    alert("Anggota berhasil diperbarui!");
    await renderAdminDashboard();
}

async function hapusAnggota(id) { if(confirm("Hapus anggota?")) { await deleteDoc(doc(anggotaRef, id)); await renderAdminDashboard(); } }

// Peminjaman manual admin
async function pinjamManual() {
    const anggotaList = await loadAnggota();
    const bukuList = await loadBuku();
    const html = `<div class="form-group"><label>Peminjam</label><select id="peminjamId"><option value="">Pilih Anggota</option>${anggotaList.map(a => `<option value="${a.id}">${escapeHtml(a.nama)} (${escapeHtml(a.kelas)})</option>`).join('')}</select></div>
        <div class="form-group"><label>Buku</label><select id="bukuId"><option value="">Pilih Buku</option>${bukuList.map(b => `<option value="${b.id}" data-stok="${b.stok}">${escapeHtml(b.judul)} (Stok: ${b.stok})</option>`).join('')}</select></div>
        <div class="form-group"><label>Tanggal Pinjam</label><input type="date" id="tglPinjamManual" value="${new Date().toISOString().split('T')[0]}"></div>
        <div class="form-group"><label>Jatuh Tempo</label><input type="date" id="tglJatuhTempoManual" value="${new Date(Date.now() + 7*24*60*60*1000).toISOString().split('T')[0]}"></div>`;
    if(!(await showModal("Peminjaman Manual (Admin)", html))) return;
    const userId = document.getElementById('peminjamId').value;
    const bukuId = document.getElementById('bukuId').value;
    const tglPinjam = document.getElementById('tglPinjamManual').value;
    const tglJatuhTempo = document.getElementById('tglJatuhTempoManual').value;
    if(!userId || !bukuId) return alert("Pilih anggota dan buku!");
    const anggotaDoc = await getDoc(doc(anggotaRef, userId));
    const bukuDoc = await getDoc(doc(bukuRef, bukuId));
    if(bukuDoc.data().stok <= 0) return alert("Stok buku habis!");
    await addDoc(peminjamanRef, { bukuId, userId, namaPeminjam: anggotaDoc.data().nama, tanggalPinjam: toTimestamp(tglPinjam), tanggalJatuhTempo: toTimestamp(tglJatuhTempo), status: 'Dipinjam', perpanjangKe: 0 });
    await updateDoc(doc(bukuRef, bukuId), { stok: bukuDoc.data().stok - 1 });
    alert("Peminjaman berhasil!");
    await renderAdminDashboard();
}

// Render dashboard admin
async function renderAdminDashboard() {
    const buku = await loadBuku(document.getElementById('searchBukuAdmin')?.value || '');
    document.querySelector('#tableBukuAdmin tbody').innerHTML = buku.map(b => `<tr><td>${escapeHtml(b.judul)}</td><td>${escapeHtml(b.penerbit)}</td><td>${escapeHtml(b.jenis)}</td><td>${b.stok}</td><td class="aksi-group"><button class="btn btn-warning btn-sm editBuku" data-id="${b.id}"><i class="fas fa-edit"></i> Edit</button><button class="btn btn-danger btn-sm hapusBuku" data-id="${b.id}"><i class="fas fa-trash"></i> Hapus</button></td></tr>`).join('');
    document.querySelectorAll('.editBuku').forEach(btn => btn.addEventListener('click', () => editBuku(btn.dataset.id)));
    document.querySelectorAll('.hapusBuku').forEach(btn => btn.addEventListener('click', () => hapusBuku(btn.dataset.id)));

    const anggota = await loadAnggota(document.getElementById('searchAnggota')?.value || '');
    document.querySelector('#tableAnggota tbody').innerHTML = anggota.map(a => `<tr><td>${escapeHtml(a.nama)}</td><td>${escapeHtml(a.kelas)}</td><td>${a.tanggalDaftar || '-'}</td><td class="aksi-group"><button class="btn btn-warning btn-sm editAnggota" data-id="${a.id}">Edit</button><button class="btn btn-danger btn-sm hapusAnggota" data-id="${a.id}">Hapus</button></td></tr>`).join('');
    document.querySelectorAll('.editAnggota').forEach(btn => btn.addEventListener('click', () => editAnggota(btn.dataset.id)));
    document.querySelectorAll('.hapusAnggota').forEach(btn => btn.addEventListener('click', () => hapusAnggota(btn.dataset.id)));

    const peminjaman = await loadPeminjaman('admin');
    document.querySelector('#tablePeminjamanAdmin tbody').innerHTML = peminjaman.map(p => {
        const { hariTerlambat, denda } = hitungDendaDanTerlambat(p.tanggalJatuhTempo, p.tglKembali);
        const statusBadge = p.status === 'Dikembalikan' ? '<span class="badge badge-dikembalikan">✓ Dikembalikan</span>' : (hariTerlambat > 0 ? '<span class="badge badge-terlambat">⚠ Terlambat</span>' : '<span class="badge badge-dipinjam">Dipinjam</span>');
        let actionButtons = '';
        if(p.status !== 'Dikembalikan') {
            actionButtons = `<button class="btn btn-info btn-sm perpanjangBtn" data-id="${p.id}" data-buku="${p.bukuId}"><i class="fas fa-calendar-plus"></i> Perpanjang</button>
                             <button class="btn btn-success btn-sm prosesKembali" data-id="${p.id}" data-buku="${p.bukuId}"><i class="fas fa-undo-alt"></i> Kembalikan</button>`;
        }
        actionButtons += `<button class="btn btn-danger btn-sm hapusTransaksi" data-id="${p.id}" data-buku="${p.bukuId}" data-status="${p.status}"><i class="fas fa-trash-alt"></i> Hapus</button>`;
        return `<tr><td>${escapeHtml(p.namaPeminjam)}</td><td>${escapeHtml(p.judulBuku)}</td><td>${formatDate(p.tanggalPinjam)}</td><td>${formatDate(p.tanggalJatuhTempo)}${p.perpanjangKe ? `<br><small class="badge badge-diperpanjang">x${p.perpanjangKe}</small>` : ''}</td><td>${formatDate(p.tglKembali)}</td><td>${hariTerlambat > 0 ? `${hariTerlambat} hari` : '-'}</td><td>${denda > 0 ? `<span class="denda-amount">${formatRupiah(denda)}</span>` : '-'}</td><td>${statusBadge}</td><td class="aksi-group">${actionButtons}</td></tr>`;
    }).join('');
    document.querySelectorAll('.perpanjangBtn').forEach(btn => btn.addEventListener('click', async () => { await perpanjangPeminjaman(btn.dataset.id); await renderAdminDashboard(); }));
    document.querySelectorAll('.prosesKembali').forEach(btn => btn.addEventListener('click', async () => { await prosesKembali(btn.dataset.id, btn.dataset.buku, false); await renderAdminDashboard(); }));
    document.querySelectorAll('.hapusTransaksi').forEach(btn => btn.addEventListener('click', async () => { await hapusPeminjaman(btn.dataset.id, btn.dataset.buku, btn.dataset.status); }));
}

// Render dashboard user
async function renderUserDashboard() {
    const buku = await loadBuku(document.getElementById('searchBukuUser')?.value || '');
    document.querySelector('#tableBukuUser tbody').innerHTML = buku.map(b => `<tr><td>${escapeHtml(b.judul)}</td><td>${escapeHtml(b.penerbit)}</td><td>${escapeHtml(b.jenis)}</td><td>${b.stok}</td><td>${b.stok > 0 ? `<button class="btn btn-primary btn-sm pinjamBukuBtn" data-id="${b.id}" data-judul="${escapeHtml(b.judul)}"><i class="fas fa-book"></i> Pinjam</button>` : 'Stok Habis'}</td></tr>`).join('');
    document.querySelectorAll('.pinjamBukuBtn').forEach(btn => btn.addEventListener('click', async () => {
        const anggotaDoc = await getDoc(doc(anggotaRef, currentUser.userId));
        if((anggotaDoc.data()?.totalDenda || 0) > 0) return alert(`Anda memiliki denda ${formatRupiah(anggotaDoc.data().totalDenda)}. Harap lunasi ke admin.`);
        const bukuId = btn.dataset.id;
        const bukuSnap = await getDoc(doc(bukuRef, bukuId));
        if(bukuSnap.exists() && bukuSnap.data().stok > 0) {
            const tanggalPinjam = Timestamp.now();
            const tanggalJatuhTempo = Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
            await addDoc(peminjamanRef, { bukuId, userId: currentUser.userId, namaPeminjam: currentUser.username, tanggalPinjam, tanggalJatuhTempo, status: 'Dipinjam', perpanjangKe: 0 });
            await updateDoc(doc(bukuRef, bukuId), { stok: bukuSnap.data().stok - 1 });
            alert(`Berhasil meminjam! Jatuh tempo: ${tanggalJatuhTempo.toDate().toLocaleDateString()}`);
            renderUserDashboard();
        } else alert("Stok habis!");
    }));
    const loans = await loadPeminjaman('user', currentUser.userId);
    document.querySelector('#tablePeminjamanUser tbody').innerHTML = loans.map(l => {
        const { hariTerlambat, denda } = hitungDendaDanTerlambat(l.tanggalJatuhTempo, l.tglKembali);
        const statusBadge = l.status === 'Dikembalikan' ? '<span class="badge badge-dikembalikan">Dikembalikan</span>' : (hariTerlambat > 0 ? '<span class="badge badge-terlambat">Terlambat</span>' : '<span class="badge badge-dipinjam">Dipinjam</span>');
        return `<tr><td>${escapeHtml(l.judulBuku)}</td><td>${formatDate(l.tanggalPinjam)}</td><td>${formatDate(l.tanggalJatuhTempo)}</td><td>${formatDate(l.tglKembali)}</td><td>${hariTerlambat > 0 ? `${hariTerlambat} hari` : '-'}</td><td>${denda > 0 ? formatRupiah(denda) : '-'}</td><td>${statusBadge}</td><td>${l.status !== 'Dikembalikan' ? `<button class="btn btn-warning btn-sm userKembaliManual" data-id="${l.id}" data-buku="${l.bukuId}"><i class="fas fa-calendar-alt"></i> Kembalikan (Pilih Tgl)</button>` : '-'}</td></tr>`;
    }).join('');
    document.querySelectorAll('.userKembaliManual').forEach(btn => btn.addEventListener('click', async () => {
        await prosesKembali(btn.dataset.id, btn.dataset.buku, true, currentUser.userId);
        await renderUserDashboard();
    }));
}

// Login
async function login(username, password, role) {
    if(role === 'admin' && username === 'admin' && password === 'admin123') { currentUser = { role: 'admin', username: 'Admin Perpus', userId: 'admin_uid' }; return true; }
    else if(role === 'user') {
        const qSnap = await getDocs(query(anggotaRef, where("nama", "==", username)));
        let found = false;
        qSnap.forEach(d => { if(d.data().password === password) { currentUser = { role: 'user', username: d.data().nama, userId: d.id }; found = true; } });
        return found;
    }
    return false;
}

// Event listeners
document.getElementById('showRegisterBtn').onclick = () => { document.getElementById('loginFormContainer').style.display = 'none'; document.getElementById('registerFormContainer').style.display = 'block'; initPasswordToggles(); };
document.getElementById('showLoginBtn').onclick = () => { document.getElementById('registerFormContainer').style.display = 'none'; document.getElementById('loginFormContainer').style.display = 'block'; initPasswordToggles(); };
document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nama = document.getElementById('regNama').value.trim();
    const kelas = document.getElementById('regKelas').value.trim();
    const password = document.getElementById('regPassword').value;
    const confirm = document.getElementById('regConfirmPassword').value;
    if(!nama || !kelas || !password) return alert("Semua field harus diisi!");
    if(password !== confirm) return alert("Password tidak cocok!");
    if(password.length < 4) return alert("Password minimal 4 karakter!");
    const qSnap = await getDocs(query(anggotaRef, where("nama", "==", nama)));
    if(!qSnap.empty) return alert("Nama sudah terdaftar!");
    await addDoc(anggotaRef, { nama, kelas, password, tanggalDaftar: new Date().toLocaleDateString('id-ID'), totalDenda: 0 });
    alert("Pendaftaran berhasil! Silakan login.");
    document.getElementById('registerFormContainer').style.display = 'none';
    document.getElementById('loginFormContainer').style.display = 'block';
});
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const success = await login(document.getElementById('loginUsername').value, document.getElementById('loginPassword').value, document.getElementById('loginRole').value);
    if(success) {
        document.getElementById('loginSection').style.display = 'none';
        document.getElementById('mainApp').style.display = 'block';
        if(currentUser.role === 'admin') {
            document.getElementById('adminPanel').style.display = 'block';
            document.getElementById('userPanel').style.display = 'none';
            document.getElementById('currentUserRole').innerHTML = `<i class="fas fa-crown"></i> Admin: ${currentUser.username}`;
            await renderAdminDashboard();
            document.getElementById('btnTambahBuku').onclick = tambahBuku;
            document.getElementById('btnTambahAnggota').onclick = tambahAnggota;
            document.getElementById('btnPinjamBukuAdmin').onclick = pinjamManual;
            document.getElementById('searchBukuAdmin').addEventListener('input', () => renderAdminDashboard());
            document.getElementById('searchAnggota').addEventListener('input', () => renderAdminDashboard());
        } else {
            document.getElementById('adminPanel').style.display = 'none';
            document.getElementById('userPanel').style.display = 'block';
            document.getElementById('currentUserRole').innerHTML = `<i class="fas fa-graduation-cap"></i> Siswa: ${currentUser.username}`;
            await renderUserDashboard();
            document.getElementById('searchBukuUser').addEventListener('input', () => renderUserDashboard());
        }
    } else alert("Login gagal!");
});
document.getElementById('logoutBtn').onclick = () => location.reload();
initPasswordToggles();

// Seed data awal
(async function seed() {
    if((await getDocs(bukuRef)).empty) {
        await addDoc(bukuRef, { judul: "Pemrograman Web Modern", penerbit: "Erlangga", jenis: "Teknologi", stok: 5 });
        await addDoc(bukuRef, { judul: "Laskar Pelangi", penerbit: "Bentang", jenis: "Fiksi", stok: 3 });
    }
    if((await getDocs(anggotaRef)).empty) await addDoc(anggotaRef, { nama: "user1", kelas: "XI RPL", password: "user123", tanggalDaftar: new Date().toLocaleDateString(), totalDenda: 0 });
})();