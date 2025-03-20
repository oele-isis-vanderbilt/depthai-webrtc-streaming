# DepthAI WebRTC Dashboard

This dashboard is an extension from [DepthAI experiments repo](https://github.com/luxonis/depthai-experiments/tree/master/gen2-webrtc-streaming) with the following modifications:
1. Streaming both RGB and Depth videos simulatenously
2. Recording the incoming video streams
3. Using Vite+React+TS for the client instead of vanilla JS

## Demo

[![Gen2 WebRTC](https://user-images.githubusercontent.com/5244214/121884542-58a1bf00-cd13-11eb-851d-dc45d541e385.gif)](https://youtu.be/8aeqGgO8LjY)

## Docker

The best way to run the application is via Docker. Please install Docker for your operating system and then run the following command:

```bash
docker-compose up --build
```

Then you should be able to visit the dashboard in the browser at ``http://localhost:5173``.

## Development & Contributing

To make changes to the client or server, you will need to run the two services natively. Running the server is performed with the following command within the ``server`` directory:

```bash
$ python main.py
======== Running on http://0.0.0.0:8081 ========
(Press CTRL+C to quit)\
```

This should start a server at port 8080 or 8081 (depending on availability). Create a ``.env`` file providing the client information about where the server is located, like such:

```bash
# .env within the client directory
VITE_DEPTHAI_SERVER_URL=http://localhost:8081
```

Now to run the client with the following command while within the ``client`` directory:

```bash
$ npm run install
$ npm run dev

  VITE v6.2.2  ready in 298 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
  ➜  press h + enter to show help
```

Now you should be able to access the DepthAI dashboard with the URL provided by Vite.