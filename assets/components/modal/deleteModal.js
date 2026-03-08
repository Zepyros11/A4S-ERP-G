let deleteCallback = null;

function openDeleteModal(message, callback) {
  deleteCallback = callback;

  document.getElementById("deleteMessage").textContent = message;

  document.getElementById("deleteModal").classList.add("open");
}

function closeDeleteModal() {
  document.getElementById("deleteModal").classList.remove("open");
}

function confirmDelete() {
  if (deleteCallback) {
    deleteCallback();
  }

  closeDeleteModal();
}
async function loadDeleteModal() {
  const res = await fetch("/assets/components/modal/deleteModal.html");
  const html = await res.text();

  document.getElementById("deleteModalContainer").innerHTML = html;
}

document.addEventListener("DOMContentLoaded", loadDeleteModal);
