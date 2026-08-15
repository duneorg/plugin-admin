/** @jsxImportSource preact */
/**
 * Island: media library — grid of files with upload, focal-point editor,
 * copy URL, and delete. Talks to /admin/api/media.
 */

import { useState, useEffect, useRef } from "preact/hooks";

interface MediaFile {
  name: string;
  url: string;
  type: string;   // "image" | "video" | "audio" | "document" | "other"
  size: number;
  contentType: string;
  page?: string;
  focalX?: number;
  focalY?: number;
}

interface PageOption {
  sourcePath: string;
  route: string;
  title: string;
}

interface Props {
  prefix: string;
}

const TYPE_FILTERS = ["all", "image", "video", "audio", "document"] as const;
type Filter = typeof TYPE_FILTERS[number];

export default function MediaLibrary({ prefix }: Props) {
  const apiBase = `${prefix}/api`;

  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<MediaFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [focalX, setFocalX] = useState(50);
  const [focalY, setFocalY] = useState(50);
  const [savingFocal, setSavingFocal] = useState(false);
  const [pages, setPages] = useState<PageOption[]>([]);
  const [destPagePath, setDestPagePath] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const focalImgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    loadMedia();
    loadPages();
  }, []);

  async function loadPages() {
    try {
      const res = await fetch(`${apiBase}/pages`);
      const d = await res.json() as { items: PageOption[] };
      const items = d.items ?? [];
      setPages(items);
      if (items.length > 0) setDestPagePath((prev) => prev || items[0].sourcePath);
    } catch { /* upload destination picker just stays empty */ }
  }

  async function loadMedia() {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/media`);
      const d = await res.json() as { items: MediaFile[] };
      setFiles(d.items ?? []);
    } finally {
      setLoading(false);
    }
  }

  const filtered = files.filter((f) => {
    if (typeFilter !== "all" && f.type !== typeFilter) return false;
    if (search && !f.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  async function upload(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files?.length) return;
    if (!destPagePath) {
      setUploadError("Choose a destination page first.");
      return;
    }
    setUploading(true);
    setUploadError("");
    try {
      for (const file of Array.from(input.files)) {
        const fd = new FormData();
        fd.append("file", file, file.name);
        fd.append("pagePath", destPagePath);
        const res = await fetch(`${apiBase}/media/upload`, {
          method: "POST",
          headers: { "X-CSRF-Token": getCsrf() },
          body: fd,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setUploadError((err as { error?: string }).error ?? `HTTP ${res.status}`);
          return;
        }
      }
      await loadMedia();
    } finally {
      setUploading(false);
      input.value = "";
    }
  }

  async function deleteFile() {
    if (!selected) return;
    if (!confirm(`Delete "${selected.name}"?`)) return;
    await fetch(`${apiBase}/media`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
      body: JSON.stringify({ pagePath: selected.page, name: selected.name }),
    });
    setSelected(null);
    await loadMedia();
  }

  function openFile(f: MediaFile) {
    setSelected(f);
    setFocalX(f.focalX ?? 50);
    setFocalY(f.focalY ?? 50);
  }

  function handleFocalClick(e: MouseEvent) {
    const img = focalImgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 100);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 100);
    setFocalX(Math.max(0, Math.min(100, x)));
    setFocalY(Math.max(0, Math.min(100, y)));
  }

  async function saveFocal() {
    if (!selected) return;
    setSavingFocal(true);
    try {
      await fetch(`${apiBase}/media/meta`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
        body: JSON.stringify({ pagePath: selected.page, name: selected.name, focal: [focalX, focalY] }),
      });
      setSelected((prev) => prev ? { ...prev, focalX, focalY } : prev);
    } finally {
      setSavingFocal(false);
    }
  }

  function copyUrl() {
    if (!selected) return;
    navigator.clipboard.writeText(selected.url).catch(() => {});
  }

  function fmtSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  return (
    <div class="media-wrap">
      {/* Toolbar */}
      <div class="media-toolbar">
        <input
          type="text"
          class="media-search"
          placeholder="Search media…"
          value={search}
          onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter((e.target as HTMLSelectElement).value as Filter)}
        >
          {TYPE_FILTERS.map((f) => (
            <option key={f} value={f}>{f === "all" ? "All types" : f.charAt(0).toUpperCase() + f.slice(1)}</option>
          ))}
        </select>
        <span class="media-count">{filtered.length} file{filtered.length !== 1 ? "s" : ""}</span>
        <select
          value={destPagePath}
          onChange={(e) => setDestPagePath((e.target as HTMLSelectElement).value)}
          disabled={pages.length === 0}
          title="Destination page for new uploads"
        >
          {pages.length === 0 && <option value="">No pages available</option>}
          {pages.map((p) => (
            <option key={p.sourcePath} value={p.sourcePath}>{p.title || p.route}</option>
          ))}
        </select>
        <button type="button"
          class="btn btn-sm btn-primary"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || !destPagePath}
        >
          {uploading ? "Uploading…" : "Upload"}
        </button>
        <input
          type="file"
          ref={fileInputRef}
          class="s-cb458930"
          multiple
          onChange={upload}
        />
      </div>

      {uploadError && <div class="alert alert-error s-9590f79e">{uploadError}</div>}

      {/* Grid */}
      {loading ? (
        <p class="s-17a730ae">Loading media files…</p>
      ) : filtered.length === 0 ? (
        <p class="s-17a730ae">No files found.</p>
      ) : (
        <div class="media-grid">
          {filtered.map((f) => (
            <div
              key={f.url}
              class={`media-item${selected?.url === f.url ? " media-item-selected" : ""}`}
              onClick={() => openFile(f)}
            >
              {f.type === "image" ? (
                <img src={f.url} alt={f.name} loading="lazy" />
              ) : (
                <div class="media-icon">
                  {f.type === "video" ? "🎬" : f.type === "audio" ? "🎵" : "📄"}
                </div>
              )}
              <div class="media-name" title={f.name}>{f.name}</div>
              <div class="media-size">{fmtSize(f.size)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Detail modal */}
      {selected && (
        <div class="modal">
          <div class="modal-backdrop" onClick={() => setSelected(null)} />
          <div class="modal-content modal-wide">
            <h3 class="s-53896af7">{selected.name}</h3>
            <div class="media-detail">
              <div class="media-detail-preview">
                {selected.type === "image" ? (
                  <div class="focal-picker-wrap s-6a1fb824" onClick={handleFocalClick}>
                    <img
                      ref={focalImgRef}
                      src={selected.url}
                      alt={selected.name}
                      class="s-48e36cb6"
                    />
                    <div
                      style={`position:absolute;width:12px;height:12px;border-radius:50%;background:rgba(79,70,229,0.8);border:2px solid white;transform:translate(-50%,-50%);top:${focalY}%;left:${focalX}%;pointer-events:none`}
                    />
                  </div>
                ) : (
                  <div class="media-icon s-37b5834e">
                    {selected.type === "video" ? "🎬" : selected.type === "audio" ? "🎵" : "📄"}
                  </div>
                )}
              </div>
              <div class="media-detail-info">
                <p><strong>Type:</strong> {selected.contentType}</p>
                <p><strong>Size:</strong> {fmtSize(selected.size)}</p>
                {selected.page && <p><strong>Page:</strong> <code>{selected.page}</code></p>}
                {selected.type === "image" && (
                  <div class="s-9dae1d00">
                    <p class="s-3b2074de">
                      <strong>Focal point:</strong> {focalX}%, {focalY}%
                    </p>
                    <p class="s-04ce2983">Click the image to set the focal point.</p>
                    <div class="s-da92b19d">
                      <button type="button"
                        class="btn btn-sm btn-primary"
                        onClick={saveFocal}
                        disabled={savingFocal}
                      >
                        {savingFocal ? "Saving…" : "Save focal point"}
                      </button>
                      <button type="button"
                        class="btn btn-sm btn-outline"
                        onClick={() => { setFocalX(50); setFocalY(50); }}
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div class="form-actions s-b06fb3de">
              <button type="button" class="btn btn-outline" onClick={() => setSelected(null)}>Close</button>
              <button type="button" class="btn btn-danger" onClick={deleteFile}>Delete</button>
              <button type="button" class="btn btn-primary" onClick={copyUrl}>Copy URL</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function getCsrf(): string {
  return (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content ?? "";
}
