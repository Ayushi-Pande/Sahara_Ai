import React, { useState } from 'react';
import { X, Check, User, Phone, Users, Shield } from 'lucide-react';

export default function EditContactModal({ contact, onSave, onClose }) {
  const [name, setName] = useState(contact?.name || '');
  const [relation, setRelation] = useState(contact?.relation || 'Friend');
  const [phone, setPhone] = useState(contact?.phone || '');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;

    onSave({
      id: contact?.id || `c-${Date.now()}`,
      name: name.trim(),
      relation: relation.trim(),
      phone: phone.trim(),
      initials: name.trim()[0]?.toUpperCase() || 'C',
      status: 'Active · On device',
    });
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
      <section className="modal edit-contact-modal" role="dialog" aria-modal="true">
        <div className="modal-heading">
          <h2>{contact ? 'Edit Trusted Contact' : 'Add Trusted Contact'}</h2>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="contact-form">
          <div className="form-field">
            <label>FULL NAME</label>
            <div className="input-wrap">
              <User size={16} />
              <input
                type="text"
                placeholder="e.g. Mom, Dr. Sarah, Sister"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-field">
            <label>RELATIONSHIP</label>
            <div className="input-wrap">
              <Users size={16} />
              <select value={relation} onChange={(e) => setRelation(e.target.value)}>
                <option value="Mother">Mother</option>
                <option value="Father">Father</option>
                <option value="Sister">Sister</option>
                <option value="Brother">Brother</option>
                <option value="Partner / Spouse">Partner / Spouse</option>
                <option value="Friend">Friend</option>
                <option value="Guardian">Guardian</option>
                <option value="Colleague">Colleague</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>

          <div className="form-field">
            <label>PHONE NUMBER (FOR CALL / SMS)</label>
            <div className="input-wrap">
              <Phone size={16} />
              <input
                type="tel"
                placeholder="e.g. +91 98765 43210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </div>
            <small className="field-hint">
              Used to generate instant tel: and sms: emergency links from your phone or browser.
            </small>
          </div>

          <div className="modal-actions">
            <button type="button" className="button button--outline" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="button button--hot">
              <Check size={16} /> Save Contact
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

