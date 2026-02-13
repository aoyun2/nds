//taken from ndstool
//http://devkitpro.svn.sourceforge.net/viewvc/devkitpro/trunk/tools/nds/ndstool/source/header.cpp?revision=3063

/* header.cpp - this file is part of DeSmuME
 *
 * Copyright (C) 2005-2006 Rafael Vuijk
 *
 * This file is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2, or (at your option)
 * any later version.
 *
 * This file is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; see the file COPYING.  If not, write to
 * the Free Software Foundation, Inc., 59 Temple Place - Suite 330,
 * Boston, MA 02111-1307, USA.
 */

#include "header.h"

//#include "ndstool.h"
//#include "banner.h"
//#include "sha1.h"
#include "crc.h"
//#include "bigint.h"
//#include "arm7_sha1_homebrew.h"
//#include "arm7_sha1_nintendo.h"
//#include "encryption.h"
//
///*
// * Data
// */

//
///*
// * CalcHeaderCRC
// */
//unsigned short CalcHeaderCRC(Header &header)
//{
//	return CalcCrc16((unsigned char *)&header, 0x15E);
//}
//
///*
// * CalcLogoCRC
// */

extern unsigned short crc16tab[];
static short MyCalcCrc(unsigned char *data, unsigned int length)
{
	short crc = (short)~0;
	for (unsigned int i=0; i<length; i++)
	{
		crc = (crc >> 8) ^ crc16tab[(crc ^ data[i]) & 0xFF];
	}
	return crc;
}

unsigned short CalcLogoCRC(Header &header)
{
	return MyCalcCrc((unsigned char *)&header + 0xC0, 156);
}
//
/*
 * DetectRomType
 */
int DetectRomType(const Header &header, char *secure)
{
	const u64 data = LE_TO_LOCAL_64(*(u64 *)secure);
	
	//this is attempting to check for an utterly invalid nds header
	if(header.unitcode > 3) return ROMTYPE_INVALID;
	
	if (header.arm9_rom_offset < 0x4000) return ROMTYPE_HOMEBREW;
	else if (data == 0x0000000000000000ULL) return ROMTYPE_MULTIBOOT;
	else if (data == 0xE7FFDEFFE7FFDEFFULL) return ROMTYPE_NDSDUMPED;
	else if (data == 0xA5C470B9014A191AULL) return ROMTYPE_NDSDUMPED; //special case for DQ5
	//TODO
	//for (int i=0x200; i<0x4000; i++)
	//	if (romdata[i]) return ROMTYPE_MASKROM;	// found something odd ;)
	return ROMTYPE_ENCRSECURE;
}



bool CheckLogoCRC(void* bytes512)
{
	Header* header = (Header*)bytes512;
	unsigned short crc = CalcLogoCRC(*header); //this isn't working, don't know why
	return header->logo_crc == crc;
}

bool DetectAnyRom(void* bytes512)
{
	//if(CheckLogoCRC(bytes512)) return true; //this isn't working

	//use other heuristics
	Header* header = (Header*)bytes512;
	//at least we have 5 bytes to ID here, not bad
	if(header->rom_header_size != 0x4000) return false;
	if(header->logo[0] != 0x24) return false;
	if(header->logo_crc != 0xCF56) return false;
	//if(header->zero[0] != 0) return false; //not sure if some weird demos will be packing data in here
	
	return true;
}