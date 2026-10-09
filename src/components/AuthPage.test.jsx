import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AuthPage from './AuthPage.jsx';

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => 'application/json' },
  json: async () => body,
});

afterEach(() => {
  sessionStorage.removeItem('sahara-backend-access-token');
  vi.unstubAllGlobals();
});

describe('AuthPage', () => {
  it('sends the backend login contract and returns to the protected destination', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      success: true,
      data: {
        access_token: 'issued-token',
        token_type: 'bearer',
        user: { id: 4, name: 'Asha', email: 'asha@example.test' },
      },
    }));
    const onAuthenticated = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={[{ pathname: '/login', state: { from: '/device-loss' } }]}>
        <Routes>
          <Route path="/login" element={<AuthPage mode="login" onAuthenticated={onAuthenticated} />} />
          <Route path="/device-loss" element={<p>Protected destination</p>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('EMAIL'), { target: { value: 'asha@example.test' } });
    fireEvent.change(screen.getByLabelText('PASSWORD'), { target: { value: 'secret-pass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Protected destination')).toBeInTheDocument();
    expect(onAuthenticated).toHaveBeenCalledWith({ id: 4, name: 'Asha', email: 'asha@example.test' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'asha@example.test', password: 'secret-pass' }),
      }),
    );
    expect(sessionStorage.getItem('sahara-backend-access-token')).toBe('issued-token');
    expect(sessionStorage.getItem('password')).toBeNull();
  });

  it('submits the backend signup fields and displays backend validation errors', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        data: {
          access_token: 'signup-token',
          token_type: 'bearer',
          user: { id: 5, name: 'Mira', email: 'mira@example.test' },
        },
      }, 201));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/signup']}>
        <Routes>
          <Route path="/signup" element={<AuthPage mode="signup" onAuthenticated={vi.fn()} />} />
          <Route path="/home" element={<p>Account created</p>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('FULL NAME'), { target: { value: 'Mira' } });
    fireEvent.change(screen.getByLabelText('PHONE (OPTIONAL)'), { target: { value: '+15550000000' } });
    fireEvent.change(screen.getByLabelText('EMAIL'), { target: { value: 'mira@example.test' } });
    fireEvent.change(screen.getByLabelText('PASSWORD'), { target: { value: 'secure-pass-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Account created')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/api/auth/signup',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'mira@example.test',
          password: 'secure-pass-123',
          name: 'Mira',
          phone: '+15550000000',
        }),
      }),
    );
  });

  it('shows invalid-credentials errors without navigating', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      success: false,
      message: 'Email or password is incorrect.',
    }, 401)));

    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<AuthPage mode="login" onAuthenticated={vi.fn()} />} />
          <Route path="/home" element={<p>Signed in</p>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('EMAIL'), { target: { value: 'wrong@example.test' } });
    fireEvent.change(screen.getByLabelText('PASSWORD'), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
    await waitFor(() => expect(screen.queryByText('Signed in')).not.toBeInTheDocument());
    expect(sessionStorage.getItem('sahara-backend-access-token')).toBeNull();
  });
});
