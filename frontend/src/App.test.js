import { render, screen } from '@testing-library/react';
import App from './App';

test('renderiza la pantalla de inicio de sesión', () => {
  render(<App />);
  expect(screen.getByText(/Iniciar Sesión/i)).toBeInTheDocument();
});
