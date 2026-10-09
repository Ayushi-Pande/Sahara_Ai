import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App.jsx';

describe('SAHARA app shell', () => {
  it('renders the app shell and landing splash content', async () => {
    render(
      <MemoryRouter initialEntries={['/home']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/SAHARA AI/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/Preparing your safe journey/i)).toBeInTheDocument();
  });
});
