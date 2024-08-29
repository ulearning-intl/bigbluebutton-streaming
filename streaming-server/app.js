const express = require('express');
const Docker = require('dockerode');
const dotenv = require('dotenv');
const axios = require('axios');
const cors = require('cors');
const constructUrl = require('./utils/construct-url');
const xmlToJson = require('./utils/xmltojson');

class BBBStreamService {
  constructor() {
    this.docker = new Docker();
    this.bbb = {
      host: process.env.BBB_URL,
      salt: process.env.BBB_SECRET,
    };
  }

  async startStream(req, res) {
    try {
      const { meetingId, hidePresentation, rtmpUrl } = req.body;

      const meetingInfo = await axios.get(
        constructUrl(this.bbb, 'getMeetingInfo', { meetingID: meetingId })
      );
      const info = xmlToJson(meetingInfo.data);
      const attendeePassword = info.response.attendeePW[0];

      const envVariables = {
        MEETING_ID: meetingId,
        ATTENDEE_PW: attendeePassword,
        HIDE_PRESENTATION: hidePresentation,
        RTMP_URL: rtmpUrl,
      };

      const image = 'bbb-stream:v1.0';
      const containers = await this.docker.listContainers({ all: true });
      const streamingContainers = containers.filter((container) => container.Image === image);

      if (streamingContainers.length >= process.env.NUMBER_OF_CONCURRENT_STREAMINGS) {
        return res
          .status(500)
          .json({ error: 'Слишком много потоков: Вы достигли лимита потоков. Попробуйте позже.' });
      }

      const containerName = `bbb-stream-${meetingId}`;
      const hostConfig = {
        Binds: ['/var/run/docker.sock:/var/run/docker.sock'],
        AutoRemove: true,
      };

      const container = await this.docker.createContainer({
        Image: image,
        name: containerName,
        Env: Object.entries(envVariables).map(([name, value]) => `${name}=${value}`),
        Tty: false,
        HostConfig: hostConfig,
      });

      await container.start();
      console.log('Поток успешно запущен');
      return res.status(200).json({ message: 'Поток успешно запущен' });
    } catch (error) {
      console.error('Ошибка при запуске потока:', error);
      return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
  }

  async stopStream(req, res) {
    try {
      const { meetingId } = req.body;
      const containerName = `bbb-stream-${meetingId}`;
      const container = this.docker.getContainer(containerName);

      await container.remove({ force: true });
      return res.status(200).json({ message: 'Поток успешно остановлен' });
    } catch (error) {
      console.error('Ошибка при остановке потока:', error);
      return res.status(500).json({ error: 'Ошибка при остановке потока' });
    }
  }
}

class App {
  constructor() {
    this.app = express();
    this.bbbStreamService = new BBBStreamService();
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(express.json({ limit: '1mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '1mb' }));
    this.app.use(express.static('public'));
    this.app.use(cors());
  }

  setupRoutes() {
    this.app.post('/bot/start', (req, res) => this.bbbStreamService.startStream(req, res));
    this.app.post('/bot/stop', (req, res) => this.bbbStreamService.stopStream(req, res));
  }

  start() {
    const PORT = 4500;
    this.app.listen(PORT, () => {
      console.log(`Сервер запущен на порту ${PORT}`);
    });
  }
}

dotenv.config();
const app = new App();
app.start();
