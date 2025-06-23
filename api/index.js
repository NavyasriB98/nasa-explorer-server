// api/apod.js
import fetch from 'node-fetch';

export default async function handler(req, res) {
  const { date } = req.query;

  const apiUrl = `https://api.nasa.gov/planetary/apod?api_key=${process.env.NASA_API_KEY}&date=${date}`;

  try {
    const response = await fetch(apiUrl);
    const data = await response.json();
    res.status(200).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch NASA data' });
  }
}
