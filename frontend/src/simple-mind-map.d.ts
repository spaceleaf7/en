declare module 'simple-mind-map' {
  class SimpleMindMap {
    constructor(opt: any);
    setData(data: any): void;
    getData(): any;
    destroy(): void;
    view: {
      reset(): void;
      fit(getRbox?: any, enlarge?: boolean, fitPadding?: number): void;
      setScale(scale: number, cx?: number, cy?: number): void;
      translateXTo(x: number): void;
      translateYTo(y: number): void;
      translateXY(x: number, y: number): void;
      scaleInCenter(scale: number, cx?: number, cy?: number): void;
      [key: string]: any;
    };
    [key: string]: any;
    static usePlugin(plugin: any, opt?: any): typeof SimpleMindMap;
  }
  export default SimpleMindMap;
}

declare module 'simple-mind-map/src/plugins/RainbowLines.js' {
  const RainbowLines: any;
  export default RainbowLines;
}
