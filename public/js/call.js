document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room') || 'Henk Uno';
  
  const displayRoomName = document.getElementById('displayRoomName');
  const confirmedRoomName = document.getElementById('confirmedRoomName');
  const btnCallNow = document.getElementById('btnCallNow');
  const categoryChips = document.querySelectorAll('.chip-option');
  const inputNotes = document.getElementById('inputNotes');
  const callCard = document.getElementById('callCard');
  const successBox = document.getElementById('successBox');
  const btnCallAgain = document.getElementById('btnCallAgain');

  let selectedCategory = 'Umum';

  // Set room name display
  displayRoomName.textContent = roomParam;
  confirmedRoomName.textContent = roomParam;

  // Category selection handler
  categoryChips.forEach(chip => {
    chip.addEventListener('click', () => {
      categoryChips.forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      selectedCategory = chip.getAttribute('data-category');
    });
  });

  // Call Button Click
  btnCallNow.addEventListener('click', async () => {
    // Disable button & show spinner
    btnCallNow.disabled = true;
    btnCallNow.innerHTML = '<span class="spinner"></span> <span>Mengirim Notifikasi...</span>';

    const payload = {
      room: roomParam,
      category: selectedCategory,
      notes: inputNotes.value ? inputNotes.value.trim() : ''
    };

    try {
      const response = await fetch('/api/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (data.success) {
        // Show success state
        callCard.style.display = 'none';
        successBox.style.display = 'block';
      } else {
        alert('Gagal mengirim panggilan: ' + (data.error || 'Terjadi kesalahan'));
        resetButton();
      }
    } catch (err) {
      console.error('Call error:', err);
      alert('Koneksi bermasalah. Pastikan jaringan internet/Wi-Fi Anda aktif.');
      resetButton();
    }
  });

  function resetButton() {
    btnCallNow.disabled = false;
    btnCallNow.innerHTML = '<span>🚨 PANGGIL BANTUAN SEGERA</span>';
  }

  // Call again button
  btnCallAgain.addEventListener('click', () => {
    successBox.style.display = 'none';
    callCard.style.display = 'block';
    resetButton();
    inputNotes.value = '';
  });
});
