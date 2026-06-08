## 1. 架构设计

```mermaid
flowchart TB
    subgraph "数据源层"
        S1["地面基站群"]
        S2["模拟数据源（开发用）"]
    end
    subgraph "后端 - Node.js"
        U["UDP Server<br/>dgram 模块"]
        P["Asterix Cat021 解包器"]
        C["数据清洗 & JSON 序列化"]
        W["WebSocket Server<br/>ws 模块"]
        M["模拟数据生成器"]
    end
    subgraph "前端 - Vue3"
        WS["WebSocket Client"]
        ST["响应式数据存储"]
        PJ["墨卡托投影转换"]
        CV["Canvas 渲染引擎"]
        UI["Vue 组件层"]
    end
    S1 -->|"UDP"| U
    S2 -->|"UDP"| M
    M -->|"模拟报文"| U
    U --> P
    P --> C
    C --> W
    W -->|"1Hz 推送"| WS
    WS --> ST
    ST --> PJ
    PJ --> CV
    ST --> UI
```

## 2. 技术说明
- **前端**：Vue3 + TypeScript + HTML5 Canvas API + Tailwind CSS
- **初始化工具**：vite-init (vue-express-ts 模板)
- **后端**：Express + TypeScript (ESM) + dgram (UDP) + ws (WebSocket)
- **数据库**：无（纯实时流，不持久化）
- **模拟数据**：内置 Asterix Cat021 模拟器，可在无真实基站时提供演示数据

## 3. 路由定义
| 路由 | 用途 |
|------|------|
| / | 雷达主屏页面（全屏 Canvas + 控制面板） |

## 4. API 定义

### 4.1 WebSocket 消息格式

**后端 → 前端（航班态势推送）**
```typescript
interface RadarTrack {
  icao24: string
  callsign: string
  lat: number
  lon: number
  altitude: number
  groundSpeed: number
  track: number
  verticalRate: number
  timestamp: number
}

interface RadarUpdate {
  type: 'track_update'
  tracks: RadarTrack[]
  timestamp: number
}
```

**前端 → 后端（控制命令）**
```typescript
interface RadarCommand {
  type: 'set_range' | 'toggle_filter' | 'select_track'
  payload: number | string | object
}
```

### 4.2 REST API（Express）
| 端点 | 方法 | 用途 |
|------|------|------|
| /api/status | GET | 获取 UDP 连接状态、包率、在线航班数 |
| /api/config | GET | 获取当前雷达配置（量程、滤镜状态） |
| /api/config | POST | 更新雷达配置 |
| /api/simulator/toggle | POST | 启停模拟数据源 |

## 5. 服务端架构图

```mermaid
flowchart LR
    UDP["UDP Server<br/>dgram.createSocket"] --> Parser["Cat021 Parser<br/>字节级解包"]
    Parser --> Cleaner["Data Cleaner<br/>字段校验+去重"]
    Cleaner --> Broadcaster["WS Broadcaster<br/>1Hz 节流推送"]
    Simulator["Simulator<br/>Asterix 报文生成"] --> UDP
    Express["Express HTTP<br/>状态查询/配置"] --> ConfigStore["Config Store<br/>内存状态"]
```

## 6. 数据模型

### 6.1 Asterix Cat021 UAP 数据项映射

| FSPEC 位 | 数据项 | ICAO 标号 | 类型 | 长度(bytes) | 说明 |
|-----------|--------|-----------|------|-------------|------|
| bit1 | DataSourceIdentifier | I021/010 | Compound | 2 | SAC+SIC |
| bit2 | TargetReportDescriptor | I021/040 | Compound | 1+ | 报告类型标识 |
| bit3 | TrackNumber | I021/161 | Unsigned | 2 | 航迹号 |
| bit4 | ServiceIdentification | I021/015 | Unsigned | 1 | 服务标识 |
| bit5 | TimeOfDay | I021/030 | Unsigned | 3 | UTC时间(1/128s) |
| bit6 | PositionWGS84 | I021/130 | Compound | 6/8 | 经纬度(精度0.0001°) |
| bit7 | PositionWGS84HighRes | I021/131 | Compound | 8 | 高精度经纬度 |
| bit8 | FlightLevel | I021/140 | Unsigned | 2 | 飞行高度层(FL/4) |
| bit9 | MOPSVersion | I021/020 | Compound | 1+ | MOPS版本 |
| bit10 | Mode3ACode | I021/070 | Compound | 2 | 应答机编码 |
| bit11 | TargetAddress | I021/110 | Unsigned | 3 | ICAO 24bit地址 |
| bit12 | TargetIdentification | I021/170 | Char | 6 | 航班号(6字符) |
| bit13 | VelocityOverGround | I021/200 | Compound | 4 | 地速+航向 |
| bit14 | TrueAirSpeed | I021/210 | Compound | 2 | 真空速 |
| bit15 | VerticalRate | I021/105 | Compound | 2 | 垂直速率(6.25ft/m) |
| bit16 | EmitterCategory | I021/020 | Compound | 1+ | 飞机类别 |

### 6.2 坐标转换：WGS84 → 墨卡托屏幕坐标

```typescript
interface ProjectionConfig {
  centerLat: number
  centerLon: number
  rangeNm: number
  canvasSize: number
}

function wgs84ToScreen(lat: number, lon: number, config: ProjectionConfig): { x: number; y: number } {
  const nmPerDegLat = 60
  const nmPerDegLon = 60 * Math.cos(config.centerLat * Math.PI / 180)
  const pixelsPerNm = config.canvasSize / (2 * config.rangeNm)
  const x = (lon - config.centerLon) * nmPerDegLon * pixelsPerNm + config.canvasSize / 2
  const y = -(lat - config.centerLat) * nmPerDegLat * pixelsPerNm + config.canvasSize / 2
  return { x, y }
}
```

## 7. Canvas 渲染架构

```mermaid
flowchart TB
    subgraph "Canvas 渲染管线 (60fps)"
        A["清除画布<br/>半透明黑色覆盖"] --> B["绘制距标环<br/>同心圆+方位线"]
        B --> C["绘制扫描线<br/>旋转+余辉衰减"]
        C --> D["绘制航迹历史<br/>尾迹点"]
        D --> E["绘制飞行器图标<br/>三角+方向"]
        E --> F["绘制速度矢量线<br/>2min预测"]
        F --> G["绘制数据标牌<br/>航班号+高度+速度"]
        G --> H["CRT后处理<br/>暗角+扫描线纹理"]
    end
```
