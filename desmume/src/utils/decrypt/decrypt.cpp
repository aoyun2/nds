//taken from ndstool and modified trivially
//http://devkitpro.svn.sourceforge.net/viewvc/devkitpro/trunk/tools/nds/ndstool/source/encryption.cpp?revision=1565

/* decrypt.cpp - this file is part of DeSmuME
 *
 * Copyright (C) 2006 Rafael Vuijk
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

#include "decrypt.h"

#include <stdlib.h>
#include <string.h>

#include "crc.h"
#include "header.h"

//encr_data
unsigned char arm7_key[4168];
// This code does not actually do the decryption, it just returns an error.

u32 card_hash[0x412];
int cardheader_devicetype = 0;
u32 global3_x00, global3_x04;	// RTC value
u32 global3_rand1;
u32 global3_rand3;




extern int emuLastError;

/*
 * decrypt_arm9
 */
static bool decrypt_arm9(u32 cardheader_gamecode, unsigned char *data)
{
	emuLastError = -1001;
	return false;
}

bool EncryptSecureArea(u8 *romheader, u8 *secure)
{
	return false;
}

bool CheckValidRom(u8 *header, u8 *secure)
{
	Header* hdr = (Header*)header;

	int romType = DetectRomType(*hdr, (char*)secure);

	return (romType != ROMTYPE_INVALID);
}