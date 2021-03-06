import { join } from "path";
import fs from "fs";
import { spawn } from "child_process";
import nbonjour from "nbonjour";
import { mergeAttributes, createAttributes } from "model-attributes";
import { Service } from "@kronos-integration/service";

export class ServiceRecorder extends Service {
  static get configurationAttributes() {
    return mergeAttributes(
      Service.configurationAttributes,
      createAttributes({
        dir: {
          type: "posix-path",
          description: "recording base directory",
          default: "/tmp"
        }
      })
    );
  }

  recorders = {};

  async _start() {
    await super._start();
    this.bonjour = nbonjour.create();

    this.bonjour.find({ type: "rtsp" }, service => {
      this.info(`Found an RTSP server ${service.fqdn}`);

      const m = service.fqdn.match(/^([^\s]+)\s+(.*)/);

      if (m) {
        const recorderName = m[1];
        const videoType = m[2];

        const encoding = videoEncoding(m[2]);

        this.trace(`RECORDER ${recorderName} ${encoding}`);

        if (encoding === undefined) {
          this.info(`Unsupported encoding ${m[2]}`);
          return;
        }

        let recorder = this.recorders[recorderName];
        if (recorder === undefined) {
          recorder = this.recorders[recorderName] = {
            fileFormat: "fragment-%03d.mp4",
            width: 640,
            height: 480,
            framerate: 15
          };
        }

        recorder.name = recorderName;

        if (recorder.videoTypes === undefined) {
          recorder.videoTypes = {};
        }

        /*
              for (const vT in recorder.videoTypes) {
                if (vT === videoType) {
                  return;
                }
              }
        */
        for (const a of service.addresses) {
          if (a.match(/^[0-9\.]+$/)) {
            recorder.address = a;
            break;
          }
        }

        recorder.url = `${service.protocol}:${service.referer.address}/${service.txt.ath}`;
        recorder.port = service.port;

        this.startRecording(recorder);
      }
    });
  }

  async startRecording(recorder) {
    if (recorder === undefined) {
      return;
    }

    if (recorder.child !== undefined) {
      this.trace(`Already running ${recorder.name} ${recorder.child.pid}`);
      return;
    }

    let videoType = "NONE";

    for (const vT in recorder.videoTypes) {
      if (videoPriorities[vT] > videoPriorities[videoType]) {
        videoType = vT;
      }
    }

    /*
    if (recorder.recordingType !== undefined) {
      if (recorder.recordingType === videoType) {
        return;
      }
  
      delete recorder.recordingType;
      if (recorder.child) {
        recorder.child.kill();
      }
      setTimeout(() => startRecording(config, recorder.name), 1000);
      return;
    }
  */

    recorder.recordingType = videoType;

    const today = new Date();

    function nts(n) {
      const s = "00" + n;
      return s.slice(s.length - 2);
    }

    const dir = join(
      this.dir,
      recorder.name,
      String(today.getFullYear()),
      nts(today.getMonth() + 1),
      nts(today.getDate())
    );

    recorder.file = join(
      dir,
      `${nts(today.getHours())}-${nts(today.getMinutes())}-${nts(
        today.getSeconds()
      )}${recorder.fileFormat}`
    );

    await fs.promises.mkdir(dir, { recursive: true, mode: "0755" });

    //recorder.url = "rtsp://10.0.3.2/mpeg4/1/media.amp";
    //ffmpeg -i rtsp://10.0.3.2/mpeg4/1/media.amp -b 900k -vcodec copy -r 60 -y MyVdeoFFmpeg.avi

    const options = [
      "-hide_banner",
      "-loglevel",
      "panic",
      "-i",
      recorder.url,
      "-acodec",
      "copy",
      "-vcodec",
      "copy",
      "-timestamp",
      "now",

      "-map",
      "0",
      "-f",
      "segment",
      "-segment_atclocktime",
      1,
      "-segment_time",
      "900",
      "-segment_format",
      "mp4",
      recorder.file

      /*
      "-y",
      recorder.file
      */
    ];

    const properties = {
      //    width: "-w",
      //    height: "-h",
      //    framerate: "-r"
    };

    Object.keys(properties).forEach(o => {
      if (recorder[o] !== undefined) {
        options.push(properties[o], recorder[o]);
      }
    });

    /*
    if (recorder.user !== undefined) {
      options.push("-u", recorder.user, recorder.password);
    }
  
    if (recorder.url === undefined) {
      recorder.url = `rtsp://${recorder.address}:${recorder.port}/${
        recorder.videoTypes[videoType]
      }`;
    }
  */

    this.trace(`ffmpeg ${JSON.stringify(options)}`);

    recorder.child = spawn("ffmpeg", options, { stdio: "inherit" });

    recorder.child.on("exit", code => {
      this.trace(`exit ${code}`);
      delete recorder.child;
      delete recorder.recordingType;
      this.startRecording(recorder);
    });

    /*
    setTimeout(() => {
      if (recorder.child !== undefined) {
        recorder.child.kill("SIGTERM");
      }
    }, (config.record.duration + 5) * 1000);
    */
  }
}

const videoPriorities = {
  "H.264": 2,
  "MPEG-4": 1,
  NONE: 0
};

function videoEncoding(type) {
  if (type.startsWith("H.264")) {
    return "H.264";
  }

  return undefined;
}
