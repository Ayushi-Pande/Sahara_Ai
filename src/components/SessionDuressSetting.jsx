import { useState } from 'react';
import { Check, LockKeyhole } from 'lucide-react';

export default function SessionDuressSetting({ duressPin, setDuressPin, notify }) {
  const [value, setValue] = useState('');
  const save = (event) => {
    event.preventDefault();
    if (!/^\d{4,8}$/.test(value)) return;
    setDuressPin(value);
    setValue('');
    notify('Duress PIN set for this app session only');
  };
  const clear = () => {
    setDuressPin('');
    notify('Session Duress PIN cleared');
  };
  return <section className="panel settings-panel pin-settings session-pin-panel"><div><span className="settings-icon"><LockKeyhole size={17} /></span><div><b>Duress PIN · session only</b><small>{duressPin ? 'Configured in memory for this browser session.' : 'Not configured. Choose 4–8 digits; it is not saved to local storage.'}</small></div></div><form onSubmit={save}><input type="password" inputMode="numeric" pattern="[0-9]{4,8}" minLength="4" maxLength="8" placeholder="Set a session PIN" value={value} onChange={(event) => setValue(event.target.value)} /><button className="button button--outline" type="submit">Set PIN <Check size={14} /></button>{duressPin && <button className="button button--dark-outline" type="button" onClick={clear}>Clear PIN</button>}</form></section>;
}
