// SPDX-License-Identifier: AGPL-3.0-or-later. RINLU 128-frame overlap-add FIR.
#pragma once
#include <array>
#include <cmath>
#include <complex>
#include <vector>

class Convolver {
    using Bin = std::complex<double>;
    using Spectrum = std::array<Bin, 256>;
    std::vector<Spectrum> response, history;
    std::array<double,128> input{},output{},overlap{};
    size_t cursor=0,head=0;
    static void transform(Spectrum &data,bool inverse){
        for(unsigned i=1,j=0;i<256;++i){
            unsigned bit=128;
            for(;j&bit;bit>>=1)j^=bit;
            j^=bit;
            if(i<j)std::swap(data[i],data[j]);
        }
        for(unsigned width=2;width<=256;width*=2){
            Bin step=std::polar(1.,(inverse?2.:-2.)*3.14159265358979323846/width);
            for(unsigned start=0;start<256;start+=width){
                Bin rot=1;
                for(unsigned j=0;j<width/2;++j){
                    Bin a=data[start+j],b=data[start+j+width/2]*rot;
                    data[start+j]=a+b;data[start+j+width/2]=a-b;rot*=step;
                }
            }
        }
        if(inverse)for(auto &v:data)v/=256.;
    }
public:
    explicit Convolver(const std::vector<double>& ir){
        if(ir.size()==1 && ir.front()==1)return;
        response.resize((ir.size()+127)/128);history.resize(response.size());
        for(size_t p=0;p<response.size();++p){
            for(size_t j=0;j<128 && p*128+j<ir.size();++j)response[p][j]=ir[p*128+j];
            transform(response[p],false);
        }
    }
    double tick(double x){
        double y=output[cursor];input[cursor]=x;
        if(++cursor!=128)return y;
        cursor=0;
        if(response.empty()){output=input;return y;}
        auto &spectrum=history[head];spectrum.fill(0);
        for(size_t j=0;j<128;++j)spectrum[j]=input[j];
        transform(spectrum,false);
        Spectrum sum{};
        for(size_t p=0;p<response.size();++p){
            const auto &block=history[(head+response.size()-p)%response.size()];
            for(size_t i=0;i<256;++i)sum[i]+=block[i]*response[p][i];
        }
        transform(sum,true);
        for(size_t i=0;i<128;++i){output[i]=sum[i].real()+overlap[i];overlap[i]=sum[i+128].real();}
        head=(head+1)%history.size();return y;
    }
};
