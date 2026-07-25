import { useState } from 'react';
import { FURN_PRESETS } from './constants.js';

// Furniture inventory for the rent-agreement Terms step. Owns furnItems/custom
// state plus the add/toggle/quantity handlers; furnItems is surfaced back to the
// container so captureFormState/applyFormState can persist it in the draft.
export function useRaFurniture() {
  const [furnItems, setFurnItems] = useState([]);
  const [custom, setCustom] = useState({ name: '', qty: 1 });

  const furnFind = (name) => furnItems.find((f) => f.name.toLowerCase() === name.toLowerCase());
  const isChecked = (name) => !!furnFind(name);
  const toggleFurn = (name) => {
    setFurnItems((arr) => (arr.some((f) => f.name.toLowerCase() === name.toLowerCase()) ? arr.filter((f) => f.name.toLowerCase() !== name.toLowerCase()) : [...arr, { name, qty: 1, custom: false }]));
  };
  const bumpQty = (i, d) => setFurnItems((arr) => arr.map((f, idx) => (idx === i ? { ...f, qty: Math.max(1, f.qty + d) } : f)));
  const removeFurn = (i) => setFurnItems((arr) => arr.filter((_, idx) => idx !== i));
  const addCustom = () => {
    const name = custom.name.trim();
    if (!name) return;
    const qty = Math.max(1, parseInt(custom.qty, 10) || 1);
    setFurnItems((arr) => {
      const ex = arr.find((f) => f.name.toLowerCase() === name.toLowerCase());
      if (ex) return arr.map((f) => (f === ex ? { ...f, qty: f.qty + qty } : f));
      return [...arr, { name, qty, custom: !FURN_PRESETS.some(([n]) => n.toLowerCase() === name.toLowerCase()) }];
    });
    setCustom({ name: '', qty: 1 });
  };
  const furnitureText = () => furnItems.map((f) => f.name + (f.qty > 1 ? ' ×' + f.qty : '')).join(', ');

  return { furnItems, setFurnItems, custom, setCustom, isChecked, toggleFurn, bumpQty, removeFurn, addCustom, furnitureText };
}
