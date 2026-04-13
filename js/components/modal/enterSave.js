/* =====================================================
   enterSave.js
   กด Enter เพื่อ Submit modal ที่ open อยู่
===================================================== */

document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  if (e.target.tagName === "TEXTAREA") return;
  if (e.target.tagName === "SELECT") return;

  // Delete Modal
  const deleteModal = document.getElementById("deleteModal");
  if (deleteModal?.classList.contains("open")) {
    e.preventDefault();
    confirmDelete?.();
    return;
  }

  // Warehouse Modal
  const warehouseModal = document.getElementById("warehouseModal");
  if (warehouseModal?.classList.contains("open")) {
    e.preventDefault();
    saveWarehouseForm?.();
    return;
  }

  // Category Modal
  const categoryModal = document.getElementById("categoryModal");
  if (categoryModal?.classList.contains("open")) {
    e.preventDefault();
    saveCategoryForm?.();
    return;
  }
});
