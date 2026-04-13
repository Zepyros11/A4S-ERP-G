/* ============================================================
   imageGrid.js — Shared reusable image grid component
   ============================================================
   Usage:
     import { ImageGrid } from "../../js/components/ui/imageGrid.js";
     const grid = new ImageGrid({ container, maxImages: 10, ... });
============================================================ */

export class ImageGrid {
  /**
   * @param {Object} opts
   * @param {HTMLElement}    opts.container    - DOM element to render into
   * @param {number}         opts.maxImages    - max number of images (default 5)
   * @param {Array}          opts.images       - initial images [{file, url}]
   * @param {number}         opts.columns      - grid columns (default 5)
   * @param {string}         opts.aspectRatio  - slot aspect ratio (default "4/3")
   * @param {Function}       opts.onAdd        - callback(files) when files added
   * @param {Function}       opts.onRemove     - callback(index) when image removed
   * @param {Function}       opts.onChange      - callback(images) when images change
   * @param {string|null}    opts.firstBadge   - badge text for first image (e.g. "โปสเตอร์")
   * @param {string|null}    opts.placeholderSrc - placeholder image for first empty slot
   * @param {HTMLElement}    opts.countEl      - optional element to show "N/max" count
   */
  constructor(opts) {
    this.container = opts.container;
    this.maxImages = opts.maxImages || 5;
    this._images = Array.isArray(opts.images) ? [...opts.images] : [];
    this.columns = opts.columns || 5;
    this.aspectRatio = opts.aspectRatio || "4/3";
    this.onAdd = opts.onAdd || null;
    this.onRemove = opts.onRemove || null;
    this.onChange = opts.onChange || null;
    this.firstBadge = opts.firstBadge || null;
    this.placeholderSrc = opts.placeholderSrc || null;
    this.countEl = opts.countEl || null;

    // create hidden file input
    this._fileInput = document.createElement("input");
    this._fileInput.type = "file";
    this._fileInput.accept = "image/*";
    this._fileInput.multiple = true;
    this._fileInput.style.display = "none";
    this.container.appendChild(this._fileInput);

    this._fileInput.addEventListener("change", (e) => {
      const files = Array.from(e.target.files || []);
      this._fileInput.value = "";
      if (!files.length) return;
      this._handleAddFiles(files);
    });

    // bind grid-level drag & drop
    this._bindGridDrop();

    this.render();
  }

  /** Get current images array (shallow copy) */
  getImages() {
    return [...this._images];
  }

  /** Set images and re-render */
  setImages(images) {
    this._images = Array.isArray(images) ? [...images] : [];
    this.render();
  }

  /** Re-render the grid */
  render() {
    // keep the file input
    const frag = document.createDocumentFragment();

    // filled slots
    this._images.forEach((item, idx) => {
      const src = item.file ? URL.createObjectURL(item.file) : item.url;
      const slot = document.createElement("div");
      slot.className = "img-grid-slot filled";
      slot.style.aspectRatio = this.aspectRatio;

      const img = document.createElement("img");
      img.src = src;
      img.alt = "img";
      slot.appendChild(img);

      const removeBtn = document.createElement("button");
      removeBtn.className = "img-grid-remove";
      removeBtn.type = "button";
      removeBtn.textContent = "\u2715";
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this._handleRemove(idx);
      });
      slot.appendChild(removeBtn);

      if (idx === 0 && this.firstBadge) {
        const badge = document.createElement("span");
        badge.className = "img-grid-badge";
        badge.textContent = this.firstBadge;
        slot.appendChild(badge);
      }

      frag.appendChild(slot);
    });

    // empty slots
    for (let i = this._images.length; i < this.maxImages; i++) {
      const slot = document.createElement("div");
      slot.className = "img-grid-slot empty";
      slot.style.aspectRatio = this.aspectRatio;

      // first slot with placeholder
      if (i === 0 && this.placeholderSrc && this._images.length === 0) {
        slot.classList.remove("empty");
        slot.classList.add("filled");
        const img = document.createElement("img");
        img.src = this.placeholderSrc;
        img.alt = "placeholder";
        img.style.opacity = "0.6";
        slot.appendChild(img);
        if (this.firstBadge) {
          const badge = document.createElement("span");
          badge.className = "img-grid-badge";
          badge.textContent = this.firstBadge;
          slot.appendChild(badge);
        }
      } else {
        const inner = document.createElement("div");
        inner.className = "img-grid-add";
        inner.innerHTML = '<span class="img-grid-add-icon">+</span>';
        slot.appendChild(inner);
      }

      slot.addEventListener("click", () => {
        this._fileInput.click();
      });

      frag.appendChild(slot);
    }

    // clear and re-append
    this.container.innerHTML = "";
    this.container.className = this.container.className.replace(/\bimg-grid\b/g, "").trim();
    this.container.classList.add("img-grid");
    this.container.style.gridTemplateColumns = `repeat(${this.columns}, 1fr)`;
    this.container.appendChild(frag);
    this.container.appendChild(this._fileInput);

    this._updateCount();
  }

  /** Cleanup */
  destroy() {
    this.container.innerHTML = "";
    this._fileInput = null;
  }

  // ── PRIVATE ──────────────────────────────────

  _handleAddFiles(files) {
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (!imageFiles.length) return;
    const remaining = this.maxImages - this._images.length;
    if (remaining <= 0) return;
    const toAdd = imageFiles.slice(0, remaining);

    if (this.onAdd) {
      // let consumer handle adding (e.g. for compression)
      this.onAdd(toAdd);
    } else {
      toAdd.forEach((f) => this._images.push({ file: f }));
      this.render();
      if (this.onChange) this.onChange(this.getImages());
    }
  }

  _handleRemove(idx) {
    this._images.splice(idx, 1);
    if (this.onRemove) this.onRemove(idx);
    this.render();
    if (this.onChange) this.onChange(this.getImages());
  }

  _bindGridDrop() {
    if (this.container._imgGridDropBound) return;
    this.container._imgGridDropBound = true;

    this.container.addEventListener("dragover", (e) => {
      e.preventDefault();
      this.container.classList.add("img-grid-drag-over");
    });
    this.container.addEventListener("dragleave", (e) => {
      if (!this.container.contains(e.relatedTarget)) {
        this.container.classList.remove("img-grid-drag-over");
      }
    });
    this.container.addEventListener("drop", (e) => {
      e.preventDefault();
      this.container.classList.remove("img-grid-drag-over");
      const files = Array.from(e.dataTransfer?.files || []).filter((f) =>
        f.type.startsWith("image/")
      );
      if (!files.length) return;
      this._handleAddFiles(files);
    });
  }

  _updateCount() {
    if (this.countEl) {
      this.countEl.textContent = `${this._images.length}/${this.maxImages}`;
    }
  }
}
