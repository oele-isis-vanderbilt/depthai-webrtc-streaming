FROM python:3.10-slim

WORKDIR /app

RUN apt-get update && apt-get install -y software-properties-common
# RUN add-apt-repository ppa:jonathonf/ffmpeg-4
RUN apt-get update && apt-get upgrade -y

#install aiortc dependencies
RUN apt-get install -y \
    libavdevice-dev \
    libavfilter-dev \
    libopus-dev \
    libvpx-dev \
    libsrtp2-dev \
    pkg-config

COPY requirements.txt requirements.txt
RUN pip install --upgrade pip
RUN pip install av==13.1.0
RUN pip install aiortc==1.10.1
RUN pip install opencv-python==4.10.0.84
RUN pip install -r requirements.txt

COPY . .

EXPOSE 8081

CMD ["python", "main.py"]
