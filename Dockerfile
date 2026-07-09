FROM node:20-bookworm

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip3 install --break-system-packages --no-cache-dir -r requirements.txt

COPY package.json server.mjs ./
COPY assets ./assets
COPY public ./public
COPY tools ./tools

ENV PORT=8792
ENV PYTHON=python3
ENV DATA_ROOT=/data

EXPOSE 8792

CMD ["node", "server.mjs"]
