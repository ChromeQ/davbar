// subset-font has no types of its own. Only the options roboto-subset.ts uses.
declare module 'subset-font' {
  type Axis = number | { min: number; max: number; default?: number };

  type Options = {
    targetFormat?: 'sfnt' | 'woff' | 'woff2';
    variationAxes?: Record<string, Axis>;
    preserveNameIds?: number[];
  };

  const subsetFont: (font: Buffer, text: string, options?: Options) => Promise<Buffer>;

  export default subsetFont;
}
