const HASH = `
float h1(float n){return fract(sin(n*12.9898)*43758.5453);}
float h2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
`;

export const BG_FRAG = `
uniform float uInv;
uniform float uSignal;
uniform float uGlitch;
uniform float uLevel;
${HASH}
float vn(vec2 p){
  vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(h2(i),h2(i+vec2(1.,0.)),f.x),mix(h2(i+vec2(0.,1.)),h2(i+vec2(1.,1.)),f.x),f.y);
}
float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<4;i++){s+=a*vn(p);p=p*2.03+17.1;a*=.5;}return s;}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  float t=uTime;
  float fr=floor(t*12.);
  float k=clamp(uSignal+uGlitch,0.,1.4);
  float slip=step(.985-k*.1,h1(fr*1.7))*(h1(fr*3.1)-.5)*.35*k;
  uv.y=fract(uv.y+slip);
  float band=floor(uv.y*36.+h1(fr)*8.);
  float tearOn=step(1.-k*.42,h2(vec2(band,fr)));
  uv.x+=tearOn*(h2(vec2(fr,band))-.5)*.22*k;
  vec2 bq=floor(uv*vec2(40.,22.5));
  float bOn=step(1.-k*k*.2,h2(bq+fr*.37));
  vec2 buv=uv+bOn*(vec2(h2(bq+3.),h2(bq+7.))-.5)*.08;
  float drift=fbm(vec2(buv.x*2.5,buv.y*5.-t*.12));
  float grain=h2(floor(gl_FragCoord.xy)+fract(t*7.13)*vec2(311.,173.))-.5;
  float roll=fract(uv.y*.55-t*.055);
  float bar=smoothstep(0.,.07,roll)*smoothstep(.24,.07,roll);
  float lum=.035*drift+.06*grain*(1.+k*2.5+uLevel*3.)+.03*bar;
  float bl=bOn*(h2(bq+fr)*.6+.15);
  float smear=smoothstep(.5,.95,vn(vec2(uv.x*5.+fr*1.3,band)));
  float orange=clamp(tearOn*smear*k*1.4+bOn*step(.62,h2(bq*1.3+fr))*.9,0.,1.);
  vec2 q=uv-.5;
  float vig=1.-dot(q,q)*1.2;
  vec3 black=vec3(.043),white=vec3(.949,.949,.925),sig=vec3(1.,.302,0.);
  vec3 night=black+vec3(max(lum,0.)+bl*.28)*vig;
  night=mix(night,sig*(.55+.45*drift),orange*.75);
  vec3 day=white-vec3(abs(lum)*1.1+bl*.55);
  day=mix(day,sig,orange*.85);
  day*=mix(1.,vig,.25);
  vec3 col=mix(night,day,uInv);
  float fringe=step(.55,k)*tearOn;
  vec3 rc=h2(vec2(band,fr+1.))>.5?vec3(1.,.12,.2):vec3(0.,.85,1.);
  col=mix(col,rc,fringe*.35*step(.5,h2(vec2(band*2.,fr+3.))));
  gl_FragColor=vec4(col,1.);
}
`;

export const FX_FRAG = `
uniform float uInv;
uniform float uGlitch;
uniform float uPower;
uniform float uFlash;
uniform vec3 uFlashCol;
${HASH}
void main(){
  vec2 fc=gl_FragCoord.xy;
  vec2 uv=fc/uRes;
  float t=uTime;
  float fr=floor(t*12.);
  float scan=step(2.,mod(fc.y,3.))*mix(.2,.07,uInv);
  vec3 col=vec3(0.);
  float a=scan;
  vec2 q=uv-.5;
  a=max(a,smoothstep(.35,.95,length(q*vec2(1.,1.25)))*mix(.5,.12,uInv));
  float band=floor(uv.y*26.+h1(fr)*26.);
  float on=step(1.-uGlitch*.22,h2(vec2(band,fr)));
  if(on>.5){
    float w=h2(vec2(band,fr+5.));
    vec3 c=w<.3?vec3(1.,.12,.2):w<.6?vec3(0.,.85,1.):w<.8?vec3(1.,.302,0.):mix(vec3(.95),vec3(.04),uInv);
    float x0=h2(vec2(band,fr+9.))*.8;
    float x1=x0+.04+h2(vec2(band,fr+11.))*.45;
    float inx=step(x0,uv.x)*step(uv.x,x1);
    col=mix(col,c,inx);
    a=mix(a,.25+.5*w,inx);
  }
  if(uPower<1.999){
    vec2 c=fc-uRes*.5;
    float hx=uPower>=1.?uRes.x*.5:max(2.,uPower*uRes.x*.5);
    float hy=uPower>=1.?max(1.5,(uPower-1.)*uRes.y*.5):1.5;
    float inside=step(abs(c.x),hx)*step(abs(c.y),hy);
    float squash=1.-clamp(uPower-1.,0.,1.);
    float lit=step(.0005,uPower);
    float d=length(vec2(max(abs(c.x)-hx,0.),max(abs(c.y)-hy,0.)));
    float glow=exp(-d/(uPower<1.?5.:14.))*lit*(.4+.6*squash);
    vec3 w=vec3(.97,.97,.94);
    float inA=pow(squash,1.6)*.95*lit;
    if(inside>.5){col=mix(col,w,inA);a=max(a,inA);}
    else{col=mix(vec3(.03),w,glow);a=1.;}
  }
  col=mix(col,uFlashCol,uFlash);
  a=mix(a,1.,uFlash);
  gl_FragColor=vec4(col,a);
}
`;
