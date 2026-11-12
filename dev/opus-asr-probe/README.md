# 复现眼镜 ASR 拒绝 Ogg/Opus

在仓库根目录执行以下命令，将探针作为独立 AIUI 应用安装到已连接的眼镜。启动后自动录音约 6.5 秒，并强制用 Ogg/Opus 打开 ASR 会话。可以用一台眼镜复现，无需配置 Prism 账号。

```sh
probe_dir="$(mktemp -d)"
cp -R dev/opus-asr-probe/app.json dev/opus-asr-probe/pages "$probe_dir/"
aix install "$probe_dir"
aix launch-page "$probe_dir" pages/voice/index
adb logcat -d -s Ink | rg 'PrismOpusProbe (capabilities|header|writeError|recStop)'
```

在 AssistServer 0.4.2（构建号 4203）上，2026-11-12 16:03 的真机日志摘录如下。

```text
16:03:18.555 capabilities ... "audioFormats":[{"mimeType":"audio/pcm","sampleRates":[16000],"channelCounts":[1],"sampleFormats":["s16"]}]
16:03:19.143 header {"format":"opus","bytes":94,"hex":"4f67675300020000000000000000024b4e4900000000dcc4357301134f7075734865616401013801803e00000000004f67675300000000000000000000024b4e4901000000222cf48e01134f7075735461677303000000496e6b00000000"}
16:03:19.151 writeError {"name":"Error","message":"NotSupportedError: Host does not support audio/ogg;codecs=opus"}
```

文件头中的 `4f676753` 是 `OggS`，`4f70757348656164` 是 `OpusHead`。探针先记录宿主的能力声明，再以 `audio/ogg;codecs=opus` 创建会话，并把文件头作为第一次 `writer.write()` 的输入。
