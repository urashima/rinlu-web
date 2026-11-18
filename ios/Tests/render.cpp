#include "../RINLU/Processor.hpp"
#include <iostream>
#include <sstream>
int main(int argc,char** argv){
 if(argc!=2)return 1;
 std::istringstream in(argv[1]);int rate,n,k;Sound s;
 in>>rate>>n>>s.bands>>s.refined>>s.boost>>s.q>>s.balance>>s.normalization>>s.bass>>s.harmonics>>s.clarity>>s.warmth>>s.deesser>>s.width>>s.crossfeed>>s.room>>s.decay>>s.compression>>s.leveling>>s.preamp>>s.pan;
 s.gains.resize(s.bands);for(auto &x:s.gains)in>>x;in>>k;s.fir.resize(k);for(auto &x:s.fir)in>>x;
 Processor p(rate,s);float v[2];while(std::cin.read((char*)v,sizeof(v))){p.tick(v[0],v[1]);std::cout.write((char*)v,sizeof(v));}return 0;
}
