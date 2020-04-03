/********************************************************
Copyright (c) <2019> <copyright ErosZy>

"Anti 996" License Version 1.0 (Draft)

Permission is hereby granted to any individual or legal entity
obtaining a copy of this licensed work (including the source code,
documentation and/or related items, hereinafter collectively referred
to as the "licensed work"), free of charge, to deal with the licensed
work for any purpose, including without limitation, the rights to use,
reproduce, modify, prepare derivative works of, distribute, publish
and sublicense the licensed work, subject to the following conditions:

1. The individual or the legal entity must conspicuously display,
without modification, this License and the notice on each redistributed
or derivative copy of the Licensed Work.

2. The individual or the legal entity must strictly comply with all
applicable laws, regulations, rules and standards of the jurisdiction
relating to labor and employment where the individual is physically
located or where the individual was born or naturalized; or where the
legal entity is registered or is operating (whichever is stricter). In
case that the jurisdiction has no such laws, regulations, rules and
standards or its laws, regulations, rules and standards are
unenforceable, the individual or the legal entity are required to
comply with Core International Labor Standards.

3. The individual or the legal entity shall not induce, suggest or force
its employee(s), whether full-time or part-time, or its independent
contractor(s), in any methods, to agree in oral or written form, to
directly or indirectly restrict, weaken or relinquish his or her
rights or remedies under such laws, regulations, rules and standards
relating to labor and employment as mentioned above, no matter whether
such written or oral agreements are enforceable under the laws of the
said jurisdiction, nor shall such individual or the legal entity
limit, in any methods, the rights of its employee(s) or independent
contractor(s) from reporting or complaining to the copyright holder or
relevant authorities monitoring the compliance of the license about
its violation(s) of the said license.

THE LICENSED WORK IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN ANY WAY CONNECTION WITH THE
LICENSED WORK OR THE USE OR OTHER DEALINGS IN THE LICENSED WORK.
*********************************************************/

import { Buffer } from 'buffer';
import EventEmitter from 'eventemitter3';
import Ticker from '../util/ticker';
import Sound from '../sound/sound';
import Util from '../util/util';

class Processor extends EventEmitter {
  constructor({
    volume = 1.0,
    muted = false,
    preloadTime = 1000,
    bufferingTime = 3000,
    cacheSegmentCount = 128
  }) {
    super();
    this.averageUnitDuration = 0;
    this.averageDecodeCost = 0;
    this.soundHeadSliced = false;
    this.framerate = 1000 / 24;
    this.isEnded = false;
    this.state = 'created';
    this.baseTime = 0;
    this.blocked = !Util.isWeChat();
    this.hasVideo = true;
    this.hasAudio = true;
    this.frames = [];
    this.audios = [];
    this.currentTime = 0;
    this.audioTime = 0;
    this.videoTime = 0;
    this.bufferingIndex = -1;
    this.minBufferingTime = preloadTime;
    this.bufferingTime = bufferingTime;
    this.cacheSegmentCount = cacheSegmentCount;
    this.ticker = new Ticker();
    this.sound = new Sound({ volume, muted });
    this.codec = new H264Codec();

    this.tickHandler = this._onTickHandler.bind(this); // ticker里面设置了timeout来循环执行handler的内容
    this.ticker.add(this.tickHandler);
    this.codec.onmessage = this._onCodecMsgHandler.bind(this);
  }

  getAvaiableDuration() {
    // 获取当前视频的持续时间
    // 音频通过this.sound.getAvaiableDuration获取，其中Duration为每个声音片段的持续时间
    // this.duration += audioBuffer.duration;
    // 视频通过获取最后一帧的时间戳得到
    // 在FFmpeg中，时间基(time_base)是时间戳(timestamp)的单位，时间戳值乘以时间基，可以得到实际的时刻值(以秒等为单位)。
    // 例如，如果一个视频帧的dts是40，pts是160，其time_base是1/1000，那么可以计算出此视频帧的解码时刻是40毫秒(40/1000)，显示时刻是160毫秒(160/1000)
    if (this.hasAudio) {
      if (this.sound) {
        return this.sound.getAvaiableDuration() * 1000;
      }
    }

    if (this.hasVideo) {
      if (this.frames.length) {
        return this.frames[this.frames.length - 1].timestamp;
      }
    }

    return 0;
  }

  getCurrentTime() {
    // AudioContext.currentTime
    // 以双精度浮点型数字返回硬件调用的秒数，AudioContext一创建就从0开始走，无法停掉、暂停或者重置。
    // this.context.currentTime - this.playStartedAt + this.skimmedTime
    if (this.hasAudio) {
      return this.sound ? this.sound.getCurrentTime() * 1000 : 0.0;
    } else if (this.hasVideo) {
      return this.currentTime;
    } else {
      return 0;
    }
  }

  process(buffer) {
    if (this.codec) {
      this.codec.decode(buffer);
    }
  }

  unblock() {
    if (Util.isWeChat()) {
      /*--------Dont Need To Implemented-------*/
    } else if (this.sound) {
      this.blocked = false;
      this.sound.unblock(0);
    }
  }

  volume(volume) {
    if (volume == null) {
      return this.sound ? this.sound.volume() : 0.0;
    } else {
      if (this.sound) {
        this.sound.volume(volume);
      }
    }
  }

  mute(muted) {
    if (muted == null) {
      return this.sound ? this.sound.mute() : true;
    } else {
      if (this.sound) {
        this.sound.mute(muted);
      }
    }
  }

  pause() {
    if (this.state == 'pasued') {
      return;
    }

    if (this.sound) {
      this.sound.pause();
    }

    if (this.ticker) {
      this.ticker.remove(this.tickHandler);
    }
    this.state = 'paused';
  }

  resume() {
    if (this.state == 'playing') {
      return;
    }

    this.state = 'playing';
    if (this.sound) {
      this.sound.resume();
    }

    if (this.ticker) {
      this.ticker.add(this.tickHandler);
    }
  }

  destroy() {
    this.removeAllListeners();
    if (this.ticker) {
      this.ticker.destroy();
    }

    if (this.sound) {
      this.sound.destroy();
    }

    if (this.codec) {
      this.codec.destroy();
    }

    this.frames = [];
    this.audios = [];
    this.ticker = null;
    this.sound = null;
    this.codec = null;
    this.state = 'destroy';
  }

  _onTickHandler() {
    if (this.state == 'created') {
      return;
    }

    if (this.hasAudio && this.hasVideo) {
      let diff = 0;
      let lastIndex = 0;
      this.currentTime = this.getCurrentTime(); // 获取音频时间戳
      if (this.frames.length) {
        lastIndex = this.frames.length - 1;
        const { timestamp: lastFrameTimestamp } = this.frames[lastIndex];
        if (this.bufferingIndex == -1) {
          this.bufferingIndex = lastIndex;  // 拿到最后一帧的index
          diff = lastFrameTimestamp - this.currentTime;  // 最后一帧的时间戳-音频的时间戳，得到缓冲区的时间差
        } else if (this.frames[this.bufferingIndex]) {
          const { timestamp } = this.frames[this.bufferingIndex];
          diff = lastFrameTimestamp - timestamp;
        }
      }

      if (
        !this.frames.length ||
        (!this.isEnded && diff && diff < this.minBufferingTime)
      ) {
        // 如果缓冲区间比较短，开始缓存，并暂停音频
        console.log("缓冲区间不足，开始缓存，并暂停音频");
        if (this.state != 'buffering') {
          this.emit('buffering');
        }
        this.sound.pause();
        this.state = 'buffering';
        return;
      } else {
        if (this.currentTime) {
          this.minBufferingTime = this.bufferingTime;
        }
        this.bufferingIndex = -1;
        if (this.state != 'buffering') {
          this.sound.resume();
        }
        if (this.blocked || !this.currentTime) {
          return;
        }
      }

      // simple solution to delay accumulation
      if (this.frames.length >= this.cacheSegmentCount * 1.5) {
        this.ticker.setFps(this.framerate * 3);
      } else if (this.frames.length < this.cacheSegmentCount / 3) {
        this.ticker.setFps(this.framerate / 1.5);
      } else {
        this.ticker.setFps(this.framerate);
      }

      // 一次解析一批动画帧，推到帧列表中，以及一个音频片段audionodebuffer
      // 在这一批动画帧里面一帧一帧遍历，只要满足当前帧的时间戳和音频的时间戳的差值小于阈值，就渲染当前帧，并从帧队列中剔除之前的帧，其他的帧不渲染
      // let minVal = 10;
      // let minIndex = -1;
      for (let i = 0; i < this.frames.length; i++) {
        // const { timestamp } = this.frames[i];
        const diffVal = Math.abs(this.currentTime - this.frames[i].timestamp);
        if (diffVal <= 25) {
          // console.log("diff is "+diff); // 音频的时间戳-帧的时间戳，如果小于0表示音频比视频慢，如果大于0表示音频比视频快
          this.emit('frame', this.frames[i]);
          this.frames.splice(0, i + 1);
          break;
        }
      }

      // for (let i = 0; i < this.frames.length; i++) {
      //   const diffVal = Math.abs(this.currentTime - this.frames[i].timestamp);
      //   if(diffVal<minVal){
      //     minVal = diffVal;
      //     minIndex = i;
      //   }
      // }
      // if(minIndex!==-1){
      //   this.audioTime = this.currentTime;
      //   this.videoTime = this.frames[minIndex].timestamp;
      //   this.emit('frame', this.frames[minIndex]);
      //   this.frames.splice(0, minIndex + 1);
      // }
    } else if (this.hasAudio) {
      const duration = this.sound.getAvaiableDuration() * 1000;
      const bufferTime = this.bufferingTime;
      this.currentTime = this.getCurrentTime();
      if (
        this.state != 'preload' &&
        this.currentTime > 0 &&
        duration - this.currentTime < bufferTime
      ) {
        this.state = 'preload';
        this.emit('preload');
      }
    } else if (this.hasVideo) {
      if (!this.isEnded && this.state == 'buffering') {
        return;
      }

      if (!this.isEnded && this.frames.length < this.cacheSegmentCount / 3) {
        this.ticker.setFps(this.framerate / 1.5);
      }
      const frame = this.frames.shift();
      if (frame) {
        this.currentTime = frame.timestamp;
        this.emit('frame', frame);
        if (this.sound) {
          this.sound.setBlockedCurrTime(this.currentTime);
        }
      }
    }

    let diff = Number.MAX_SAFE_INTEGER;
    if (this.hasVideo && this.frames.length) {
      const lastIndex = this.frames.length - 1;
      const currentTime = this.currentTime;
      diff = this.frames[lastIndex].timestamp - currentTime;
    }

    if (
      !this.isEnded &&
      this.state != 'buffering' &&
      (this.hasVideo && !this.hasAudio) &&
      diff < this.bufferingTime
    ) {
      this.state = 'buffering';
      this.emit('buffering');
      return;
    }

    if (
      this.hasVideo &&
      this.state != 'preload' &&
      this.state != 'buffering' &&
      (this.frames.length < this.cacheSegmentCount ||
        diff < this.averageDecodeCost * 1.3)
    ) {
      this.state = 'preload';
      this.emit('preload');
    }
  }

  _onCodecMsgHandler(msg) {
    if (this.state == 'destroy') {
      return;
    }

    const { type } = msg;
    switch (type) {
      case 'ready': {
        this.emit('buffering');
        break;
      }
      case 'header': {
        const { hasVideo, hasAudio } = msg.data;
        this.hasVideo = hasVideo;
        this.hasAudio = hasAudio;
        if (!this.hasAudio) {
          this.sound.destroy();
          this.sound = null;
        }
        this.emit('header', msg.data);
        break;
      }
      case 'mediaInfo': {
        try {
          msg.data = JSON.parse(msg.data);
        } catch (e) {}
        const info = msg.data['onMetaData'] || [];
        if (this.ticker) {
          for (let i = 0; i < info.length; i++) {
            const { framerate } = info[i];
            if (framerate) {
              this.framerate = framerate;
              this.ticker.setFps(framerate);
              break;
            }
          }
        }

        this.emit('mediaInfo', msg.data);
        break;
      }
      case 'video': {
        const {
          timestamp,
          width,
          height,
          stride0,
          stride1,
          buffer
        } = msg.data;
        if (!this.baseTime) {
          this.baseTime = timestamp;
        }

        this.frames.push({
          data: Buffer.from(new Uint8Array(buffer)),
          timestamp: timestamp - this.baseTime,
          width,
          height,
          stride0,
          stride1
        });
        break;
      }
      case 'audio': {
        const { timestamp, buffer } = msg.data;
        if (!this.baseTime) {
          this.baseTime = timestamp;
        }
        this.audios.push(Buffer.from(new Uint8Array(buffer)));
        break;
      }
      case 'decode': {
        if (
          this.state == 'buffering' ||
          (this.hasVideo && this.state != 'playing') ||
          (!this.hasVideo && this.hasAudio && this.state != 'playing')
        ) {
          this.emit('playing');
        }

        this.state = 'playing';
        this.ticker.setFps(this.framerate);

        const { consume, duration } = msg.data;

        if (!this.averageDecodeCost) {
          this.averageDecodeCost = consume;
        } else {
          this.averageDecodeCost += consume;
          this.averageDecodeCost /= 2.0;
        }

        if (!this.averageUnitDuration) {
          this.averageUnitDuration = duration;
        } else {
          this.averageUnitDuration += duration;
          this.averageUnitDuration /= 2.0;
        }

        this.emit('performance', {
          averageDecodeCost: this.averageDecodeCost,
          averageUnitDuration: this.averageUnitDuration
        });

        if (this.hasAudio) {
          this.currentTime = this.getCurrentTime();
          if (!this.soundHeadSliced) {
            this.soundHeadSliced = true;
            if (this.frames.length) {
              const frame = this.frames.shift();
              this.emit('frame', frame);
            }
            this.sound.decode(Buffer.concat(this.audios.splice(0, 32)));
          }
          this.sound.decode(Buffer.concat(this.audios));
          this.audios = [];
        }
        break;
      }
      case 'complete': {
        this.isEnded = true;
        this.state = 'end';
        this.emit('end');
        break;
      }
      default: {
        break;
      }
    }
  }
}

export default Processor;
