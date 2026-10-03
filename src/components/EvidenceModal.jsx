import React, { useState } from 'react';
import { X, Upload, FileText, Image as ImageIcon, MapPin, Tag, Plus, Check } from 'lucide-react';

export default function EvidenceModal({ onClose, onSave, currentLocation }) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Safety Concern');
  const [notes, setNotes] = useState('');
  const [imageData, setImageData] = useState(null);
  const [fileName, setFileName] = useState('');

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setImageData(event.target?.result);
      };
      reader.readAsDataURL(file);
    } else {
      setImageData(null);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!title.trim() && !notes.trim()) return;

    const newEvidence = {
      id: `ev-${Date.now()}`,
      title: title.trim() || `${category} Record`,
      category,
      notes: notes.trim(),
      fileName: fileName || (imageData ? 'Captured Image.png' : 'Text Record'),
      fileType: imageData ? 'image' : 'note',
      imagePreview: imageData,
      timestamp: new Date().toISOString(),
      location: currentLocation
        ? `${currentLocation.latitude.toFixed(5)}, ${currentLocation.longitude.toFixed(5)}`
        : 'Location unavailable',
    };

    onSave(newEvidence);
    onClose();
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section className="modal evidence-add-modal" role="dialog" aria-modal="true">
        <div className="modal-heading">
          <h2>Add Evidence to Local Vault</h2>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="evidence-form">
          <div className="form-field">
            <label>INCIDENT TITLE / SUBJECT</label>
            <input
              type="text"
              placeholder="e.g. Broken streetlight on 4th Ave, Suspicious vehicle"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div className="form-field">
            <label>CATEGORY</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="Poor Lighting">Poor Lighting / Infrastructure</option>
              <option value="Harassment / Catcalling">Harassment / Catcalling</option>
              <option value="Suspicious Activity">Suspicious Activity</option>
              <option value="Unsafe Route">Unsafe / Deserted Route</option>
              <option value="Safe Haven Note">Safe Haven / Verified Public Spot</option>
              <option value="General Safety Note">General Safety Note</option>
            </select>
          </div>

          <div className="form-field">
            <label>OBSERVATION NOTES</label>
            <textarea
              rows={3}
              placeholder="Provide objective factual notes (time, direction, vehicle number, etc.)..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="form-field file-upload-field">
            <label>ATTACH PHOTO OR AUDIO (STORED LOCALLY)</label>
            <div className="file-dropzone">
              <input
                type="file"
                accept="image/*,audio/*,.txt"
                onChange={handleFileChange}
                id="vault-file-input"
              />
              <label htmlFor="vault-file-input" className="file-dropzone-label">
                <Upload size={20} />
                <span>{fileName ? `Selected: ${fileName}` : 'Choose an image or note file'}</span>
                <small>File will be encoded directly into your browser's private local storage</small>
              </label>
            </div>

            {imageData && (
              <div className="vault-image-preview">
                <img src={imageData} alt="Evidence preview" />
                <button
                  type="button"
                  className="remove-img-btn"
                  onClick={() => {
                    setImageData(null);
                    setFileName('');
                  }}
                >
                  <X size={14} /> Remove
                </button>
              </div>
            )}
          </div>

          <div className="vault-storage-disclaimer">
            <small>
              🔒 <b>STORED LOCALLY ON THIS DEVICE:</b> Uploaded files and notes remain inside your
              browser's storage. They are never sent to external servers or cloud repositories.
            </small>
          </div>

          <div className="modal-actions">
            <button type="button" className="button button--outline" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="button button--hot">
              <Check size={16} /> Save to Vault
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

