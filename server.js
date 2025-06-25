const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());

app.get('/api/apod', async (req, res) => {
  const { date } = req.query;

  const apiUrl = `https://api.nasa.gov/planetary/apod?api_key=${process.env.NASA_API_KEY}`
    + (date ? `&date=${date}` : '');

  try {
    const response = await axios.get(apiUrl);
    res.json(response.data);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: 'Failed to fetch APOD data' });
  }
});

app.listen(5000, () => console.log('Backend is ready on port 5000!')); 