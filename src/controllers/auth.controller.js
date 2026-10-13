import * as auth from '../services/auth.service.js';

export const login = async (req, res) => {
  const { email, password } = req.validated.body;
  res.json(await auth.login(email, password));
};
export const demo = async (_req, res) => res.json(await auth.demoLogin());
export const me = async (req, res) => res.json({ user: await auth.currentUser(req.user.id) });
export const logout = (_req, res) => res.status(204).end(); // stateless JWT: the client discards the token
