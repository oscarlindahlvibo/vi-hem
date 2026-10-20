"""Synthetic Codec 8 Extended frames. Never impersonate a purchased/production tracker."""
import argparse
import datetime
import socket
import struct
import time
IMEI='990000000000001'

def frame(stamp, latitude, longitude, speed, ignition=True, odometer=22146000):
    body=struct.pack('>QBiihHBH',int(stamp*1000),1,int(longitude*1e7),int(latitude*1e7),100,180,10,speed)
    one=[(239,int(ignition)),(240,int(speed>0)),(21,4),(89,55)]
    two=[(66,13800),(36,1500 if ignition else 0)]
    four=[(16,odometer),(87,odometer)]
    body+=struct.pack('>HHH',239,len(one)+len(two)+len(four),len(one))
    for key,value in one:body+=struct.pack('>HB',key,value)
    body+=struct.pack('>H',len(two))
    for key,value in two:body+=struct.pack('>HH',key,value)
    body+=struct.pack('>H',len(four))
    for key,value in four:body+=struct.pack('>HI',key,value)
    body+=struct.pack('>HH',0,0) # N8 and NX
    data=b'\x8e\x01'+body+b'\x01'
    crc=0
    for byte in data:
        crc^=byte
        for _ in range(8):crc=(crc>>1)^0xA001 if crc&1 else crc>>1
    return b'\0'*4+struct.pack('>I',len(data))+data+struct.pack('>I',crc)

def run(host,port):
    assert host in ('localhost','127.0.0.1'), 'Simulation only allowed on isolated loopback listener'
    start=time.time()-600
    with socket.create_connection((host,port),timeout=10) as sock:
        sock.sendall(struct.pack('>H',len(IMEI))+IMEI.encode())
        assert sock.recv(1)==b'\x01','IMEI not registered in isolated Traccar'
        for seconds,lat,speed,ignition in [(0,57.317,30,True),(60,57.318,30,True),(120,57.319,0,False),(300,57.319,0,False)]:
            sock.sendall(frame(start+seconds,lat,15.583,speed,ignition,22146000+seconds*10))
            assert sock.recv(4)==b'\0\0\0\x01','Record was not acknowledged'
    print('PASS Teltonika Codec 8 Extended IMEI handshake and four AVL acknowledgements; synthetic device only')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--host',default='127.0.0.1');p.add_argument('--port',type=int,default=15027);a=p.parse_args();run(a.host,a.port)
